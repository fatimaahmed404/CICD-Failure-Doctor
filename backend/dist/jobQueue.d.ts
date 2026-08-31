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
import type { DiagnosisJob } from "./types.js";
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
export declare function processJob(job: DiagnosisJob): Promise<void>;
/**
 * Adds a diagnosis job to the in-process queue.
 * Returns immediately — the job runs asynchronously in the background.
 *
 * Requirements: 3.1
 */
export declare function enqueue(job: DiagnosisJob): void;
//# sourceMappingURL=jobQueue.d.ts.map