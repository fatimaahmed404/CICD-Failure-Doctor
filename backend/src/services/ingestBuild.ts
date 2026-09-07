/**
 * ingestBuild service
 *
 * Validates an incoming build payload, persists a BuildRecord with
 * `status = "pending"`, enqueues the async diagnosis job, and returns
 * the created record — all within ~200 ms (no LLM work on this path).
 *
 * Requirements: 1.1, 1.3, 1.4, 10.2, 10.3, 10.4
 */

import { insertBuildRecord } from "../db/buildRecords.js";
import { enqueue } from "../jobQueue.js";
import type { BuildRecord, BuildSource, WebhookPayload } from "../types.js";

// ── SimulatePayload ───────────────────────────────────────────────────────────

/**
 * Payload shape produced by the /simulate route.
 * Identical to WebhookPayload but without a `source` field (source is always
 * "simulate" and is passed separately to ingestBuild).
 */
export interface SimulatePayload {
  log: string;
  repoName: string;
  jobName: string;
  commitSha: string;
  branch?: string;
}

// ── Validation error ──────────────────────────────────────────────────────────

/**
 * Thrown by `ingestBuild` when one or more required fields fail validation.
 * The route handler maps this to HTTP 400 `{ error, details }`.
 */
export class IngestValidationError extends Error {
  public readonly details: string[];

  constructor(details: string[]) {
    super("Validation failed");
    this.name = "IngestValidationError";
    this.details = details;
  }
}

// ── Validation helpers ────────────────────────────────────────────────────────

const COMMIT_SHA_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i;
const VALID_SOURCES: ReadonlySet<string> = new Set([
  "github",
  "jenkins",
  "simulate",
]);

/** Returns true if the value is a non-empty, non-whitespace-only string. */
function isPresent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ── Public service function ───────────────────────────────────────────────────

/**
 * Validates `payload` + `source`, persists a pending BuildRecord, enqueues
 * the diagnosis job, and returns the record.
 *
 * Throws `IngestValidationError` when any field is invalid.
 *
 * Requirements: 1.1, 1.3, 1.4, 10.2, 10.3, 10.4
 */
export async function ingestBuild(
  payload: WebhookPayload | SimulatePayload,
  source: BuildSource,
  userId?: string | null,
): Promise<BuildRecord> {
  const details: string[] = [];

  // ── Required field presence checks ───────────────────────────────────────
  if (!isPresent(payload.log)) {
    details.push("log is required and must not be blank");
  }
  if (!isPresent(payload.repoName)) {
    details.push("repoName is required and must not be blank");
  }
  if (!isPresent(payload.jobName)) {
    details.push("jobName is required and must not be blank");
  }
  if (!isPresent(payload.commitSha)) {
    details.push("commitSha is required and must not be blank");
  } else if (!COMMIT_SHA_RE.test(payload.commitSha)) {
    // Only check format when the value is present
    details.push(
      "commitSha must be a 40- or 64-character hexadecimal string",
    );
  }

  // ── Source validation ─────────────────────────────────────────────────────
  if (!VALID_SOURCES.has(source)) {
    details.push(
      `source must be one of "github", "jenkins", or "simulate" — got "${source}"`,
    );
  }

  if (details.length > 0) {
    throw new IngestValidationError(details);
  }

  // ── Persist (insertBuildRecord also validates commitSha + source as
  //    a defence-in-depth check — those errors would be unexpected here) ────
  const record = insertBuildRecord({
    repoName: payload.repoName,
    jobName: payload.jobName,
    commitSha: payload.commitSha,
    source,
    rawLog: payload.log,
    branch: payload.branch ?? null,
    userId: userId ?? null,
  });

  // ── Enqueue — synchronous hand-off to the in-process queue ───────────────
  enqueue({ buildRecordId: record.id });

  return record;
}
