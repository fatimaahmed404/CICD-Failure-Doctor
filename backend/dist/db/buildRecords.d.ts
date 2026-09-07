/**
 * BuildRecord data-access functions.
 *
 * All SQL is executed synchronously via better-sqlite3.
 * UUID v4 generation is handled here on insert so callers never supply an id.
 *
 * Requirements: 10.2, 10.3, 10.4, 10.6
 */
import type { BuildRecord, BuildStatus, BuildSource, FailureCategory, ConfidenceLevel } from "../types.js";
/** Typed error thrown when insert-time validation fails. */
export declare class BuildRecordValidationError extends Error {
    readonly field: string;
    constructor(message: string, field: string);
}
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
export declare function insertBuildRecord(input: InsertBuildRecordInput): BuildRecord;
/**
 * Returns the BuildRecord for the given id, or `null` if not found.
 */
export declare function getBuildRecordById(id: string): BuildRecord | null;
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
export declare function updateBuildRecord(id: string, input: UpdateBuildRecordInput): void;
export interface ListBuildRecordsOptions {
    page?: number;
    limit?: number;
    category?: FailureCategory | null;
    userId?: string | null;
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
export declare function listBuildRecords(options?: ListBuildRecordsOptions): BuildRecordPage;
//# sourceMappingURL=buildRecords.d.ts.map