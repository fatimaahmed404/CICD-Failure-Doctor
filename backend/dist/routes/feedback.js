"use strict";
/**
 * Feedback API routes (stretch feature).
 *
 * POST /diagnoses/:id/feedback  — Submit helpfulness rating
 * GET /feedback/stats           — Aggregate stats across all categories
 *
 * Requirements: 13.2, 13.3, 13.4
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.feedbackRouter = void 0;
const express_1 = require("express");
const buildRecords_js_1 = require("../db/buildRecords.js");
const feedback_js_1 = require("../db/feedback.js");
const router = (0, express_1.Router)();
exports.feedbackRouter = router;
// ── POST /diagnoses/:id/feedback ──────────────────────────────────────────────
/**
 * Submits a helpfulness rating for a diagnosis.
 *
 * Requirements:
 *  - 13.2: one feedback record per diagnosis per user (upsert by client_id)
 *  - 13.4: validate rating is exactly "helpful" or "unhelpful"
 *
 * Headers:
 *  - X-Client-Id: anonymous UUID from localStorage (required)
 *
 * Body:
 *  - rating: "helpful" | "unhelpful"
 *
 * Returns:
 *  - 200 FeedbackResponse (id, buildRecordId, clientId, rating, createdAt)
 *  - 400 if X-Client-Id is absent, rating is invalid, or diagnosis does not exist
 */
router.post("/:id/feedback", (req, res) => {
    const buildRecordId = req.params["id"];
    const clientId = req.headers["x-client-id"];
    const { rating } = req.body;
    // Validate X-Client-Id header is present and non-empty
    if (!clientId || typeof clientId !== "string" || clientId.trim() === "") {
        res.status(400).json({ error: "Missing or empty X-Client-Id header" });
        return;
    }
    // Validate rating is provided
    if (!rating || typeof rating !== "string") {
        res.status(400).json({ error: "Missing or invalid rating field" });
        return;
    }
    // Validate rating is exactly "helpful" or "unhelpful" (Req 13.4)
    if (rating !== "helpful" && rating !== "unhelpful") {
        res.status(400).json({ error: "Invalid rating value" });
        return;
    }
    // Verify the diagnosis exists
    const buildRecord = (0, buildRecords_js_1.getBuildRecordById)(buildRecordId);
    if (!buildRecord) {
        res.status(400).json({ error: "Diagnosis not found" });
        return;
    }
    try {
        const feedbackRecord = (0, feedback_js_1.upsertFeedback)(buildRecordId, clientId, rating);
        // Return FeedbackResponse
        res.status(200).json({
            id: feedbackRecord.id,
            buildRecordId: feedbackRecord.buildRecordId,
            clientId: feedbackRecord.clientId,
            rating: feedbackRecord.rating,
            createdAt: feedbackRecord.createdAt.toISOString(),
        });
    }
    catch (err) {
        if (err instanceof feedback_js_1.FeedbackValidationError) {
            res.status(400).json({ error: err.message });
            return;
        }
        // Re-throw unexpected errors to be caught by global error handler
        throw err;
    }
});
// ── GET /feedback/stats ───────────────────────────────────────────────────────
/**
 * Returns aggregate helpfulness statistics for all seven failure categories.
 * Categories with no ratings return { helpful: 0, unhelpful: 0 }.
 *
 * Requirements: 13.3
 *
 * Returns:
 *  - 200 { stats: FailureCategoryStats[] }
 */
router.get("/stats", (_req, res) => {
    const stats = (0, feedback_js_1.getFeedbackStats)();
    const response = {
        stats,
    };
    res.status(200).json(response);
});
//# sourceMappingURL=feedback.js.map