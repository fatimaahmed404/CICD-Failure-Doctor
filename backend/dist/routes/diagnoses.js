/**
 * Diagnoses API routes.
 *
 * GET /diagnoses        — paginated + filtered list of DiagnosisSummary objects
 * GET /diagnoses/:id    — full DiagnosisDetail for a single record
 * GET /health           — uptime-monitor ping
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 11.4
 */
import { Router } from "express";
import { getBuildRecordById, listBuildRecords, } from "../db/buildRecords.js";
const router = Router();
// ── Valid FailureCategory values (kept in sync with types.ts) ─────────────────
const VALID_CATEGORIES = new Set([
    "dependency-build-error",
    "test-failure",
    "docker-build-failure",
    "env-var-secrets",
    "timeout-infrastructure",
    "syntax-lint-error",
    "unknown",
]);
// ── Mappers ───────────────────────────────────────────────────────────────────
/**
 * Extracts the first sentence from an explanation string.
 * Returns null if explanation is null.
 */
function firstSentence(explanation) {
    if (!explanation)
        return null;
    const match = explanation.match(/^[^.!?]*[.!?]/);
    return match ? match[0].trim() : explanation.trim();
}
function toSummary(record) {
    return {
        id: record.id,
        repoName: record.repoName,
        jobName: record.jobName,
        commitSha: record.commitSha,
        source: record.source,
        status: record.status,
        category: record.category,
        explanation: firstSentence(record.explanation),
        confidence: record.confidence,
        createdAt: record.createdAt.toISOString(),
        completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    };
}
function toDetail(record) {
    return {
        ...toSummary(record),
        suggestedFix: record.suggestedFix,
        rawLog: record.rawLog,
        truncated: record.truncated,
    };
}
// ── GET /diagnoses ─────────────────────────────────────────────────────────────
/**
 * Returns a paginated, optionally category-filtered list of DiagnosisSummary objects.
 *
 * Query params:
 *   page     — 1-based page number (default 1)
 *   limit    — page size, 1–100 (default 20)
 *   category — optional FailureCategory filter
 *
 * Requirements: 7.1, 7.2, 7.5, 7.6, 7.7
 */
router.get("/", (req, res) => {
    const rawPage = req.query.page;
    const rawLimit = req.query.limit;
    const rawCategory = req.query.category;
    // Validate category if provided (Req 7.7)
    if (rawCategory !== undefined && rawCategory !== null && rawCategory !== "") {
        if (!VALID_CATEGORIES.has(rawCategory)) {
            res.status(400).json({ error: `Invalid category: "${rawCategory}"` });
            return;
        }
    }
    const page = rawPage ? Math.max(1, parseInt(rawPage, 10) || 1) : 1;
    const limit = rawLimit
        ? Math.min(100, Math.max(1, parseInt(rawLimit, 10) || 20))
        : 20;
    const category = rawCategory && VALID_CATEGORIES.has(rawCategory)
        ? rawCategory
        : null;
    const result = listBuildRecords({ page, limit, category });
    const response = {
        data: result.data.map(toSummary),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
    };
    res.status(200).json(response);
});
// ── GET /diagnoses/:id ────────────────────────────────────────────────────────
/**
 * Returns the full DiagnosisDetail for a single record.
 * Returns 404 when no record with the given id exists.
 *
 * Requirements: 7.3, 7.4
 */
router.get("/:id", (req, res) => {
    const id = req.params["id"];
    const record = getBuildRecordById(id);
    if (!record) {
        res.status(404).json({ error: "Not found" });
        return;
    }
    res.status(200).json(toDetail(record));
});
export { router as diagnosesRouter };
//# sourceMappingURL=diagnoses.js.map