/**
 * Feedback data-access functions for the helpfulness feedback stretch feature.
 *
 * Provides upsert functionality for per-diagnosis ratings and stats aggregation
 * across all seven failure categories.
 *
 * Requirements: 13.2, 13.3
 */
import type { FeedbackRating, FeedbackRecord, FailureCategoryStats } from "../types.js";
/** Typed error thrown when insert-time validation fails. */
export declare class FeedbackValidationError extends Error {
    readonly field: string;
    constructor(message: string, field: string);
}
/**
 * Upserts a feedback record for the given buildRecordId and clientId.
 * Uses INSERT OR REPLACE to enforce one rating per client per diagnosis.
 *
 * Requirements: 13.2
 */
export declare function upsertFeedback(buildRecordId: string, clientId: string, rating: FeedbackRating): FeedbackRecord;
/**
 * Returns feedback statistics for all seven failure categories.
 * Categories with no ratings return { helpful: 0, unhelpful: 0 }.
 *
 * Requirements: 13.3
 */
export declare function getFeedbackStats(): FailureCategoryStats[];
//# sourceMappingURL=feedback.d.ts.map