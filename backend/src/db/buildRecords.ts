/**
 * BuildRecord data-access functions.
 *
 * All SQL is executed synchronously via better-sqlite3.
 * UUID v4 generation is handled here on insert so callers never supply an id.
 *
 * Requirements: 10.2, 10.3, 10.4, 10.6
 */

import { v4 as uuidv4 } from "uuid";
import { db } from "./init.js";
import type {
  BuildRecord,
  BuildStatus,
  BuildSource,
  FailureCategory,
  ConfidenceLevel,
} from "../types.js";

// ── Validation helpers ────────────────────────────────────────────────────────

const COMMIT_SHA_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i;
const VALID_SOURCES: ReadonlySet<string> = new Set([
  "github",
  "jenkins",
  "simulate",
]);

/** Typed error thrown when insert-time validation fails. */
export class BuildRecordValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message);
    this.name = "BuildRecordValidationError";
  }
}

function validateCommitSha(commitSha: string): void {
  if (!COMMIT_SHA_RE.test(commitSha)) {
    throw new BuildRecordValidationError(
      `commitSha must be a 40- or 64-character hexadecimal string, got: "${commitSha}"`,
      "commitSha",
    );
  }
}

function validateSource(source: string): asserts source is BuildSource {
  if (!VALID_SOURCES.has(source)) {
    throw new BuildRecordValidationError(
      `source must be one of "github", "jenkins", or "simulate", got: "${source}"`,
      "source",
    );
  }
}

// ── Row ↔ domain mappers ──────────────────────────────────────────────────────

interface BuildRecordRow {
  id: string;
  repo_name: string;
  job_name: string;
  commit_sha: string;
  branch: string | null;
  source: string;
  raw_log: string;
  cleaned_log: string | null;
  truncated: number;      // SQLite stores booleans as 0/1
  status: string;
  category: string | null;
  explanation: string | null;
  suggested_fix: string | null;
  confidence: string | null;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  user_id: string | null;
}

function rowToDomain(row: BuildRecordRow): BuildRecord {
  return {
    id: row.id,
    repoName: row.repo_name,
    jobName: row.job_name,
    commitSha: row.commit_sha,
    branch: row.branch,
    source: row.source as BuildSource,
    rawLog: row.raw_log,
    cleanedLog: row.cleaned_log,
    truncated: row.truncated === 1,
    status: row.status as BuildStatus,
    category: row.category as FailureCategory | null,
    explanation: row.explanation,
    suggestedFix: row.suggested_fix,
    confidence: row.confidence as ConfidenceLevel | null,
    retryCount: row.retry_count,
    errorMessage: row.error_message,
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    userId: row.user_id,
  };
}

// ── Insert ────────────────────────────────────────────────────────────────────

export interface InsertBuildRecordInput {
  repoName: string;
  jobName: string;
  commitSha: string;
  source: BuildSource;
  rawLog: string;
  branch?: string | null;
  userId?: string | null;
}

/**
 * Inserts a new BuildRecord with `status = "pending"`.
 * Generates a UUID v4 for `id` and sets `createdAt` to now.
 *
 * Throws `BuildRecordValidationError` for invalid `commitSha` or `source`.
 *
 * Requirements: 10.2, 10.3, 10.4
 */
export function insertBuildRecord(input: InsertBuildRecordInput): BuildRecord {
  validateCommitSha(input.commitSha);
  validateSource(input.source);

  const id = uuidv4();
  const createdAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO build_records
      (id, repo_name, job_name, commit_sha, branch, source, raw_log,
       cleaned_log, truncated, status, category, explanation, suggested_fix,
       confidence, retry_count, error_message, created_at, completed_at, user_id)
    VALUES
      (@id, @repo_name, @job_name, @commit_sha, @branch, @source, @raw_log,
       @cleaned_log, @truncated, @status, @category, @explanation, @suggested_fix,
       @confidence, @retry_count, @error_message, @created_at, @completed_at, @user_id)
  `);

  stmt.run({
    id,
    repo_name: input.repoName,
    job_name: input.jobName,
    commit_sha: input.commitSha,
    branch: input.branch ?? null,
    source: input.source,
    raw_log: input.rawLog,
    cleaned_log: null,
    truncated: 0,
    status: "pending",
    category: null,
    explanation: null,
    suggested_fix: null,
    confidence: null,
    retry_count: 0,
    error_message: null,
    created_at: createdAt,
    completed_at: null,
    user_id: input.userId ?? null,
  });

  // Return the freshly inserted record as a domain object
  return getBuildRecordById(id) as BuildRecord;
}

// ── Select by ID ──────────────────────────────────────────────────────────────

/**
 * Returns the BuildRecord for the given id, or `null` if not found.
 */
export function getBuildRecordById(id: string): BuildRecord | null {
  const stmt = db.prepare<[string]>(
    "SELECT * FROM build_records WHERE id = ?",
  );
  const row = stmt.get(id) as BuildRecordRow | undefined;
  return row ? rowToDomain(row) : null;
}

// ── Update ────────────────────────────────────────────────────────────────────

/**
 * Fields that may be updated on an existing BuildRecord.
 *
 * `completedAt` is set automatically when `status` transitions to
 * `"complete"` or `"unavailable"` — callers must NOT supply it directly.
 * Requirements: 10.6
 */
export interface UpdateBuildRecordInput {
  status?: BuildStatus;
  cleanedLog?: string | null;
  truncated?: boolean;
  category?: FailureCategory | null;
  explanation?: string | null;
  suggestedFix?: string | null;
  confidence?: ConfidenceLevel | null;
  retryCount?: number;
  errorMessage?: string | null;
}

/**
 * Applies a partial update to a BuildRecord identified by `id`.
 * When `status` transitions to `"complete"` or `"unavailable"`,
 * `completedAt` is automatically set to the current UTC timestamp.
 *
 * No-ops silently when the record does not exist.
 *
 * Requirements: 10.6
 */
export function updateBuildRecord(
  id: string,
  input: UpdateBuildRecordInput,
): void {
  // Determine whether to set completedAt
  const isTerminal =
    input.status === "complete" || input.status === "unavailable";

  const setClauses: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: Record<string, any> = { id };

  if (input.status !== undefined) {
    setClauses.push("status = @status");
    params.status = input.status;
  }
  if (input.cleanedLog !== undefined) {
    setClauses.push("cleaned_log = @cleaned_log");
    params.cleaned_log = input.cleanedLog;
  }
  if (input.truncated !== undefined) {
    setClauses.push("truncated = @truncated");
    params.truncated = input.truncated ? 1 : 0;
  }
  if (input.category !== undefined) {
    setClauses.push("category = @category");
    params.category = input.category;
  }
  if (input.explanation !== undefined) {
    setClauses.push("explanation = @explanation");
    params.explanation = input.explanation;
  }
  if (input.suggestedFix !== undefined) {
    setClauses.push("suggested_fix = @suggested_fix");
    params.suggested_fix = input.suggestedFix;
  }
  if (input.confidence !== undefined) {
    setClauses.push("confidence = @confidence");
    params.confidence = input.confidence;
  }
  if (input.retryCount !== undefined) {
    setClauses.push("retry_count = @retry_count");
    params.retry_count = input.retryCount;
  }
  if (input.errorMessage !== undefined) {
    setClauses.push("error_message = @error_message");
    params.error_message = input.errorMessage;
  }

  // Automatically set completedAt on terminal transitions (Req 10.6)
  if (isTerminal) {
    setClauses.push("completed_at = @completed_at");
    params.completed_at = new Date().toISOString();
  }

  if (setClauses.length === 0) {
    return; // nothing to update
  }

  const sql = `UPDATE build_records SET ${setClauses.join(", ")} WHERE id = @id`;
  db.prepare(sql).run(params);
}

// ── List (paginated + filtered) ───────────────────────────────────────────────

export interface ListBuildRecordsOptions {
  page?: number;      // 1-based, default 1
  limit?: number;     // default 20, max 100
  category?: FailureCategory | null;
  userId?: string | null;  // undefined = no filter; null = demo records; string = user records
}

export interface BuildRecordPage {
  data: BuildRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Returns a paginated, optionally category-filtered list of BuildRecords
 * sorted by `created_at DESC`.
 *
 * If `page` is beyond the last page, returns an empty `data` array with
 * the correct `total` (not an error). Requirements: 7.6
 */
export function listBuildRecords(
  options: ListBuildRecordsOptions = {},
): BuildRecordPage {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.limit ?? 20));
  const offset = (page - 1) * pageSize;
  const category = options.category ?? null;

  const whereParts: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filterParams: Record<string, any> = {};

  if (category !== null) {
    whereParts.push("category = @category");
    filterParams.category = category;
  }

  // userId filter: undefined = no filter, null = demo records (IS NULL), string = specific user
  if (options.userId !== undefined) {
    if (options.userId === null) {
      whereParts.push("user_id IS NULL");
    } else {
      whereParts.push("user_id = @user_id");
      filterParams.user_id = options.userId;
    }
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  // Total count for the current filter
  const countRow = db
    .prepare<Record<string, unknown>>(
      `SELECT COUNT(*) AS total FROM build_records ${whereClause}`,
    )
    .get(filterParams) as { total: number } | undefined;
  const total = countRow?.total ?? 0;

  // Data rows
  const rows = db
    .prepare<Record<string, unknown>>(
      `SELECT * FROM build_records ${whereClause}
       ORDER BY created_at DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...filterParams, limit: pageSize, offset }) as BuildRecordRow[];

  return {
    data: rows.map(rowToDomain),
    total,
    page,
    pageSize,
  };
}
