/**
 * Feedback data-access functions for the helpfulness feedback stretch feature.
 *
 * Provides upsert functionality for per-diagnosis ratings and stats aggregation
 * across all seven failure categories.
 *
 * Requirements: 13.2, 13.3
 */
import { v4 as uuidv4 } from "uuid";
import { db } from "./init.js";
// ── Validation helpers ────────────────────────────────────────────────────────
const VALID_RATINGS = new Set(["helpful", "unhelpful"]);
/** Typed error thrown when insert-time validation fails. */
export class FeedbackValidationError extends Error {
    field;
    constructor(message, field) {
        super(message);
        this.field = field;
        this.name = "FeedbackValidationError";
    }
}
function validateRating(rating) {
    if (!VALID_RATINGS.has(rating)) {
        throw new FeedbackValidationError(`rating must be "helpful" or "unhelpful", got: "${rating}"`, "rating");
    }
}
function rowToDomain(row) {
    return {
        id: row.id,
        buildRecordId: row.build_record_id,
        clientId: row.client_id,
        rating: row.rating,
        createdAt: new Date(row.created_at),
    };
}
// ── Upsert ────────────────────────────────────────────────────────────────────
/**
 * Upserts a feedback record for the given buildRecordId and clientId.
 * Uses INSERT OR REPLACE to enforce one rating per client per diagnosis.
 *
 * Requirements: 13.2
 */
export function upsertFeedback(buildRecordId, clientId, rating) {
    validateRating(rating);
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const stmt = db.prepare(`
    INSERT OR REPLACE INTO feedback
      (id, build_record_id, client_id, rating, created_at)
    VALUES
      (@id, @build_record_id, @client_id, @rating, @created_at)
  `);
    stmt.run({
        id,
        build_record_id: buildRecordId,
        client_id: clientId,
        rating,
        created_at: createdAt,
    });
    // Return the freshly upserted record
    const getStmt = db.prepare("SELECT * FROM feedback WHERE build_record_id = ? AND client_id = ?");
    const row = getStmt.get(buildRecordId, clientId);
    return rowToDomain(row);
}
// ── Feedback stats ────────────────────────────────────────────────────────────
/**
 * Returns feedback statistics for all seven failure categories.
 * Categories with no ratings return { helpful: 0, unhelpful: 0 }.
 *
 * Requirements: 13.3
 */
export function getFeedbackStats() {
    const allCategories = [
        "dependency-build-error",
        "test-failure",
        "docker-build-failure",
        "env-var-secrets",
        "timeout-infrastructure",
        "syntax-lint-error",
        "unknown",
    ];
    // Query aggregates helpful/unhelpful counts per category
    const query = `
    SELECT
      br.category,
      SUM(CASE WHEN f.rating = 'helpful' THEN 1 ELSE 0 END) AS helpful,
      SUM(CASE WHEN f.rating = 'unhelpful' THEN 1 ELSE 0 END) AS unhelpful
    FROM build_records br
    LEFT JOIN feedback f ON br.id = f.build_record_id
    WHERE br.category IS NOT NULL
    GROUP BY br.category
  `;
    const rows = db.prepare(query).all();
    // Build a map of category → stats
    const statsMap = new Map();
    for (const row of rows) {
        statsMap.set(row.category, {
            category: row.category,
            helpful: row.helpful,
            unhelpful: row.unhelpful,
        });
    }
    // Return all seven categories with 0 defaults for missing ones
    return allCategories.map((category) => {
        return (statsMap.get(category) ?? {
            category,
            helpful: 0,
            unhelpful: 0,
        });
    });
}
//# sourceMappingURL=feedback.js.map