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
// ── Validation helpers ────────────────────────────────────────────────────────
const COMMIT_SHA_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i;
const VALID_SOURCES = new Set([
    "github",
    "jenkins",
    "simulate",
]);
/** Typed error thrown when insert-time validation fails. */
export class BuildRecordValidationError extends Error {
    field;
    constructor(message, field) {
        super(message);
        this.field = field;
        this.name = "BuildRecordValidationError";
    }
}
function validateCommitSha(commitSha) {
    if (!COMMIT_SHA_RE.test(commitSha)) {
        throw new BuildRecordValidationError(`commitSha must be a 40- or 64-character hexadecimal string, got: "${commitSha}"`, "commitSha");
    }
}
function validateSource(source) {
    if (!VALID_SOURCES.has(source)) {
        throw new BuildRecordValidationError(`source must be one of "github", "jenkins", or "simulate", got: "${source}"`, "source");
    }
}
function rowToDomain(row) {
    return {
        id: row.id,
        repoName: row.repo_name,
        jobName: row.job_name,
        commitSha: row.commit_sha,
        branch: row.branch,
        source: row.source,
        rawLog: row.raw_log,
        cleanedLog: row.cleaned_log,
        truncated: row.truncated === 1,
        status: row.status,
        category: row.category,
        explanation: row.explanation,
        suggestedFix: row.suggested_fix,
        confidence: row.confidence,
        retryCount: row.retry_count,
        errorMessage: row.error_message,
        createdAt: new Date(row.created_at),
        completedAt: row.completed_at ? new Date(row.completed_at) : null,
    };
}
/**
 * Inserts a new BuildRecord with `status = "pending"`.
 * Generates a UUID v4 for `id` and sets `createdAt` to now.
 *
 * Throws `BuildRecordValidationError` for invalid `commitSha` or `source`.
 *
 * Requirements: 10.2, 10.3, 10.4
 */
export function insertBuildRecord(input) {
    validateCommitSha(input.commitSha);
    validateSource(input.source);
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const stmt = db.prepare(`
    INSERT INTO build_records
      (id, repo_name, job_name, commit_sha, branch, source, raw_log,
       cleaned_log, truncated, status, category, explanation, suggested_fix,
       confidence, retry_count, error_message, created_at, completed_at)
    VALUES
      (@id, @repo_name, @job_name, @commit_sha, @branch, @source, @raw_log,
       @cleaned_log, @truncated, @status, @category, @explanation, @suggested_fix,
       @confidence, @retry_count, @error_message, @created_at, @completed_at)
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
    });
    // Return the freshly inserted record as a domain object
    return getBuildRecordById(id);
}
// ── Select by ID ──────────────────────────────────────────────────────────────
/**
 * Returns the BuildRecord for the given id, or `null` if not found.
 */
export function getBuildRecordById(id) {
    const stmt = db.prepare("SELECT * FROM build_records WHERE id = ?");
    const row = stmt.get(id);
    return row ? rowToDomain(row) : null;
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
export function updateBuildRecord(id, input) {
    // Determine whether to set completedAt
    const isTerminal = input.status === "complete" || input.status === "unavailable";
    const setClauses = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params = { id };
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
/**
 * Returns a paginated, optionally category-filtered list of BuildRecords
 * sorted by `created_at DESC`.
 *
 * If `page` is beyond the last page, returns an empty `data` array with
 * the correct `total` (not an error). Requirements: 7.6
 */
export function listBuildRecords(options = {}) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.limit ?? 20));
    const offset = (page - 1) * pageSize;
    const category = options.category ?? null;
    let whereClause = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filterParams = {};
    if (category !== null) {
        whereClause = "WHERE category = @category";
        filterParams.category = category;
    }
    // Total count for the current filter
    const countRow = db
        .prepare(`SELECT COUNT(*) AS total FROM build_records ${whereClause}`)
        .get(filterParams);
    const total = countRow?.total ?? 0;
    // Data rows
    const rows = db
        .prepare(`SELECT * FROM build_records ${whereClause}
       ORDER BY created_at DESC
       LIMIT @limit OFFSET @offset`)
        .all({ ...filterParams, limit: pageSize, offset });
    return {
        data: rows.map(rowToDomain),
        total,
        page,
        pageSize,
    };
}
//# sourceMappingURL=buildRecords.js.map