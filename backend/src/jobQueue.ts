/**
 * Async Job Queue
 *
 * Processes BuildRecords off the request path using p-queue (concurrency: 2).
 * Each job:
 *   1. Fetches the BuildRecord from SQLite.
 *   2. Runs log truncation and persists cleanedLog + truncated flag.
 *   3. Calls the LLM to produce a DiagnosisResult, with one retry on NetworkError.
 *   4. Updates the record to status="complete" or "unavailable".
 *   5. Fires a fire-and-forget notification (never blocks the job).
 *
 * A 120-second watchdog wraps every processJob call via Promise.race; on
 * expiry the record is forced to status="unavailable" with a specific message.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.2, 6.3, 6.4
 */

import PQueue from "p-queue";
import { getBuildRecordById, updateBuildRecord } from "./db/buildRecords.js";
import { truncateLog } from "./logProcessor.js";
import { diagnoseBuild, LLMParseError, NetworkError } from "./llmClient.js";
import { notify } from "./services/notificationService.js";
import type { DiagnosisJob } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum LLM attempts: initial call + 1 retry for NetworkError. */
const MAX_ATTEMPTS = 2;

/** Delay (ms) between NetworkError attempts. */
const RETRY_DELAY_MS = 1_000;

/** SLA deadline (ms) per job — Req 3.5. */
const SLA_TIMEOUT_MS = 120_000;

// ── In-process queue ──────────────────────────────────────────────────────────

const queue = new PQueue({ concurrency: 2 });

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns a Promise that rejects after `ms` milliseconds. */
function timeoutReject(ms: number): Promise<never> {
  return new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new SLATimeoutError(`Diagnosis SLA timeout: exceeded 120 s`)),
      ms,
    ),
  );
}

/** Internal sentinel error — only used inside the SLA race. */
class SLATimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SLATimeoutError";
  }
}

/** Pause execution for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Core job processor ────────────────────────────────────────────────────────

/**
 * Processes a single DiagnosisJob:
 *
 * - Fetches the BuildRecord; skips silently if not found.
 * - Truncates the raw log and persists cleanedLog + truncated.
 * - Calls `diagnoseBuild` up to MAX_ATTEMPTS times:
 *     • LLMParseError → unavailable immediately (no retry).
 *     • NetworkError  → wait RETRY_DELAY_MS, retry once.
 * - On success: status="complete" + all DiagnosisResult fields + completedAt.
 * - On exhausted retries: status="unavailable" + errorMessage + completedAt.
 * - After status="complete": fire-and-forget notify(); errors only logged.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4
 */
export async function processJob(job: DiagnosisJob): Promise<void> {
  const { buildRecordId } = job;

  // ── Fetch record ──────────────────────────────────────────────────────────
  const record = getBuildRecordById(buildRecordId);
  if (!record) {
    console.warn(`[jobQueue] BuildRecord not found, skipping job: ${buildRecordId}`);
    return;
  }

  // ── Log truncation ────────────────────────────────────────────────────────
  const truncateResult = truncateLog(record.rawLog);
  updateBuildRecord(buildRecordId, {
    cleanedLog: truncateResult.cleanedLog,
    truncated: truncateResult.truncated,
  });

  // ── LLM diagnosis with retry ──────────────────────────────────────────────
  let attempt = 0;
  let lastError: Error | undefined;

  while (attempt < MAX_ATTEMPTS) {
    try {
      const result = await diagnoseBuild({
        cleanedLog: truncateResult.cleanedLog,
        repoName: record.repoName,
        jobName: record.jobName,
        source: record.source,
      });

      // ── Success ───────────────────────────────────────────────────────────
      updateBuildRecord(buildRecordId, {
        status: "complete",
        category: result.category,
        explanation: result.explanation,
        suggestedFix: result.suggestedFix,
        confidence: result.confidence,
        retryCount: attempt,       // 0 = first attempt succeeded, 1 = retry succeeded
      });

      // Fire-and-forget notification — never block or affect BuildRecord status.
      // Re-fetch to get the fully populated record for the notification payload.
      const completedRecord = getBuildRecordById(buildRecordId);
      if (completedRecord) {
        (async () => {
          try {
            await notify(completedRecord, result);
          } catch (notifErr) {
            console.error("[jobQueue] Notification failed:", notifErr);
          }
        })();
      }

      return;
    } catch (err) {
      if (err instanceof LLMParseError) {
        // Parse errors are not retryable — fail immediately.
        updateBuildRecord(buildRecordId, {
          status: "unavailable",
          retryCount: attempt,
          errorMessage: err.message,
        });
        console.error(`[jobQueue] LLMParseError for ${buildRecordId}:`, err.message);
        return;
      }

      if (err instanceof NetworkError) {
        lastError = err;
        attempt += 1;
        if (attempt < MAX_ATTEMPTS) {
          console.warn(
            `[jobQueue] NetworkError for ${buildRecordId} (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${RETRY_DELAY_MS}ms:`,
            err.message,
          );
          await sleep(RETRY_DELAY_MS);
        }
        continue;
      }

      // Unexpected error type — treat as non-retryable.
      lastError = err instanceof Error ? err : new Error(String(err));
      break;
    }
  }

  // ── All attempts exhausted (or unexpected error) ──────────────────────────
  updateBuildRecord(buildRecordId, {
    status: "unavailable",
    retryCount: Math.min(attempt, MAX_ATTEMPTS - 1),  // 0 or 1
    errorMessage: lastError?.message ?? "Unknown error",
  });
  console.error(
    `[jobQueue] All attempts exhausted for ${buildRecordId}:`,
    lastError?.message,
  );
}

// ── SLA-bounded wrapper ───────────────────────────────────────────────────────

/**
 * Wraps `processJob` in a 120-second SLA timeout.
 * If the job does not complete within the SLA, the record is forced to
 * `status = "unavailable"` with the canonical timeout error message.
 *
 * Requirements: 3.5
 */
async function processJobWithSLA(job: DiagnosisJob): Promise<void> {
  try {
    await Promise.race([processJob(job), timeoutReject(SLA_TIMEOUT_MS)]);
  } catch (err) {
    if (err instanceof SLATimeoutError) {
      console.error(
        `[jobQueue] SLA timeout for ${job.buildRecordId}: ${err.message}`,
      );
      updateBuildRecord(job.buildRecordId, {
        status: "unavailable",
        errorMessage: "Diagnosis SLA timeout: exceeded 120 s",
      });
    } else {
      // Unexpected error that escaped processJob — log and mark unavailable.
      const msg =
        err instanceof Error ? err.message : String(err);
      console.error(`[jobQueue] Unexpected error for ${job.buildRecordId}:`, msg);
      updateBuildRecord(job.buildRecordId, {
        status: "unavailable",
        errorMessage: msg,
      });
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Adds a diagnosis job to the in-process queue.
 * Returns immediately — the job runs asynchronously in the background.
 *
 * Requirements: 3.1
 */
export function enqueue(job: DiagnosisJob): void {
  queue.add(() => processJobWithSLA(job)).catch((err) => {
    // p-queue itself should not reject for non-priority queues, but guard anyway.
    console.error("[jobQueue] Unexpected queue error:", err);
  });
}
