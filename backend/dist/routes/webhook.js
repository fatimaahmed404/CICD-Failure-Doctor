"use strict";
/**
 * POST /webhook/ingest
 *
 * Receives failed build payloads from GitHub Actions or Jenkins, authenticates
 * the request via the shared `X-Webhook-Secret` header, validates the payload,
 * and enqueues an async diagnosis job.
 *
 * Response codes:
 *   202 — accepted, record persisted and job enqueued
 *   400 — validation failure (missing/blank fields, bad commitSha or source)
 *   401 — missing or incorrect X-Webhook-Secret header
 *   413 — payload exceeds 10 MB
 *   500 — server misconfiguration (WEBHOOK_SECRET env var not set)
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const validateWebhook_js_1 = require("../auth/validateWebhook.js");
const ingestBuild_js_1 = require("../services/ingestBuild.js");
const router = express_1.default.Router();
// ── Body parser with 10 MB limit (Req 1.6) ───────────────────────────────────
const jsonBodyParser = express_1.default.json({ limit: "10mb" });
// ── Allowed sources for the webhook path ─────────────────────────────────────
const WEBHOOK_SOURCES = new Set(["github", "jenkins"]);
// ── Route handler ─────────────────────────────────────────────────────────────
router.post("/webhook/ingest", 
// 1. Parse JSON body; the error handler below catches entity.too.large
jsonBodyParser, 
// 2. Handle body-parser errors (oversized payload → 413)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
(err, _req, res, next) => {
    if (err !== null &&
        typeof err === "object" &&
        "type" in err &&
        err.type === "entity.too.large") {
        res.status(413).json({ error: "Payload too large" });
        return;
    }
    next(err);
}, 
// 3. Business logic handler
async (req, res) => {
    // ── Authentication (Req 1.2, 9.x) ──────────────────────────────────────
    const authResult = (0, validateWebhook_js_1.validateWebhookRequest)(req);
    if (!authResult.valid) {
        res.status(authResult.statusCode ?? 401).json({
            error: authResult.statusCode === 500
                ? "Internal server error"
                : "Invalid or missing webhook secret",
        });
        return;
    }
    const body = req.body;
    // ── Source validation (Req 1.7) ─────────────────────────────────────────
    // Must be exactly "github" or "jenkins" (case-sensitive). Checked here
    // before calling ingestBuild so we can return a clear 400 message without
    // conflating with ingestBuild's own source check (which also allows
    // "simulate").
    const rawSource = body.source;
    if (typeof rawSource !== "string" || !WEBHOOK_SOURCES.has(rawSource)) {
        res.status(400).json({
            error: "Validation failed",
            details: [
                `source must be exactly "github" or "jenkins" (case-sensitive) — got ${JSON.stringify(rawSource)}`,
            ],
        });
        return;
    }
    const source = rawSource;
    // ── Ingest (validates remaining fields, persists record, enqueues job) ──
    try {
        const record = await (0, ingestBuild_js_1.ingestBuild)(body, source);
        res.status(202).json({ id: record.id, status: "pending" });
    }
    catch (err) {
        if (err instanceof ingestBuild_js_1.IngestValidationError) {
            // Req 1.3 — missing / blank / malformed fields
            res.status(400).json({ error: err.message, details: err.details });
            return;
        }
        // Unexpected error — let the global error handler deal with it
        throw err;
    }
});
exports.default = router;
//# sourceMappingURL=webhook.js.map