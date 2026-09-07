"use strict";
/**
 * Diagnoses API routes.
 *
 * GET /diagnoses        — paginated + filtered list of DiagnosisSummary objects
 * GET /diagnoses/:id    — full DiagnosisDetail for a single record
 * GET /health           — uptime-monitor ping
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 11.4
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicDiagnosesRouter = exports.diagnosesRouter = void 0;
const express_1 = require("express");
const buildRecords_js_1 = require("../db/buildRecords.js");
const authService_js_1 = require("../auth/authService.js");
const router = (0, express_1.Router)();
exports.diagnosesRouter = router;
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
// ── optionalAuth middleware ───────────────────────────────────────────────────
/**
 * Reads `auth_token` cookie; if valid, sets req.user.  Always calls next().
 */
function optionalAuth(req, _res, next) {
    const token = req.cookies?.auth_token;
    if (token) {
        const user = (0, authService_js_1.verifyToken)(token);
        if (user) {
            req.user = user;
        }
    }
    next();
}
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
router.get("/", optionalAuth, (req, res) => {
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
    // Authenticated users see their own records; unauthenticated see demo records (userId: null)
    const userId = req.user ? req.user.userId : null;
    const result = (0, buildRecords_js_1.listBuildRecords)({ page, limit, category, userId });
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
 * Returns 404 when no record with the given id exists or is not accessible.
 *
 * Requirements: 7.3, 7.4
 */
router.get("/:id", optionalAuth, (req, res) => {
    const id = req.params["id"];
    const record = (0, buildRecords_js_1.getBuildRecordById)(id);
    if (!record) {
        res.status(404).json({ error: "Not found" });
        return;
    }
    // Access control: authenticated users can only see their own records;
    // unauthenticated users can only see demo records (userId: null).
    if (req.user) {
        if (record.userId !== req.user.userId) {
            res.status(404).json({ error: "Not found" });
            return;
        }
    }
    else {
        if (record.userId !== null) {
            res.status(404).json({ error: "Not found" });
            return;
        }
    }
    res.status(200).json(toDetail(record));
});
// ── Public diagnoses router (demo records only) ───────────────────────────────
const publicRouter = (0, express_1.Router)();
exports.publicDiagnosesRouter = publicRouter;
publicRouter.get("/diagnoses", (req, res) => {
    const rawPage = req.query.page;
    const rawLimit = req.query.limit;
    const rawCategory = req.query.category;
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
    // Public router always returns demo records (userId: null)
    const result = (0, buildRecords_js_1.listBuildRecords)({ page, limit, category, userId: null });
    const response = {
        data: result.data.map(toSummary),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
    };
    res.status(200).json(response);
});
//# sourceMappingURL=diagnoses.js.map