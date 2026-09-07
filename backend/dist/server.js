"use strict";
/**
 * Express server entry point.
 *
 * startup.ts MUST be called first — before any middleware or route registration —
 * so the process exits immediately if required environment variables are absent.
 *
 * Requirements: 11.2, 11.4
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
// ---- Boot-time guard (must be first) ----------------------------------------
const startup_js_1 = require("./startup.js");
require("dotenv/config");
(0, startup_js_1.validateEnvironment)();
// ---- Dependencies ------------------------------------------------------------
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const crypto_1 = require("crypto");
// Initialize the SQLite database and run schema migrations at startup
require("./db/init.js");
const express_rate_limit_1 = require("express-rate-limit");
const express_session_1 = __importDefault(require("express-session"));
const diagnoses_js_1 = require("./routes/diagnoses.js");
const webhook_js_1 = __importDefault(require("./routes/webhook.js"));
const simulate_js_1 = __importDefault(require("./routes/simulate.js"));
const feedback_js_1 = require("./routes/feedback.js");
const github_js_1 = require("./routes/github.js");
const githubConnection_js_1 = require("./services/githubConnection.js");
// ---- CORS configuration ------------------------------------------------------
const CORS_ORIGINS = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
    : ["http://localhost:5173",
        "https://cicd-failure-doctor-frontend.vercel.app"];
// ---- Rate limiter (task 11.2) ------------------------------------------------
// Applied only to POST /webhook/ingest and POST /simulate.
// 20 requests per minute per IP; exceeding the limit returns 429.
// Requirements: security considerations (design doc)
const postRouteLimiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 60 * 1000, // 1 minute
    max: 20,
    standardHeaders: true, // emit RateLimit-* headers (RFC draft 7)
    legacyHeaders: false,
    message: { error: "Too many requests" },
});
// ---- App setup ---------------------------------------------------------------
const app = (0, express_1.default)();
exports.app = app;
// CORS must be applied before all routes
app.use((0, cors_1.default)({ origin: CORS_ORIGINS }));
// ── Session middleware (required for OAuth state parameter) ───────────────────
// SESSION_SECRET should be set in production. If absent, a random secret is
// generated so the server still starts, but sessions won't persist across restarts.
const sessionSecret = (() => {
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim() !== "") {
        return process.env.SESSION_SECRET.trim();
    }
    const fallback = (0, crypto_1.randomBytes)(32).toString("hex");
    console.warn("[startup] SESSION_SECRET not set — sessions will not persist across restarts");
    return fallback;
})();
app.use((0, express_session_1.default)({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 10 * 60 * 1000, // 10 minutes — long enough to complete OAuth flow
    },
}));
app.use(express_1.default.json({ limit: "10mb" }));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
// ---- Routes ------------------------------------------------------------------
// Webhook ingestion (POST /webhook/ingest) — rate limited
app.use(postRouteLimiter, webhook_js_1.default);
// Simulate (POST /simulate) — rate limited
app.use("/simulate", postRouteLimiter, simulate_js_1.default);
// Diagnoses API (GET /diagnoses, GET /diagnoses/:id)
app.use("/diagnoses", diagnoses_js_1.diagnosesRouter);
// Feedback API (POST /diagnoses/:id/feedback mounted via feedbackRouter)
// GET /feedback/stats
app.use("/feedback", feedback_js_1.feedbackRouter);
// Also mount feedback POST route under /diagnoses/:id/feedback
app.use("/diagnoses", feedback_js_1.feedbackRouter);
// ── GitHub OAuth routes (includes /config, /auth/github/*, /github/*) ─────────
// githubRouter always exposes GET /config.
// All OAuth-specific routes (/auth/github/login, /auth/github/callback,
// /github/repos, /github/connect-repo, /github/disconnect) are self-gated
// inside the router by isOAuthEnabled() — they are only registered when both
// GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set.
// Requirements: 17.1, 17.2
app.use(github_js_1.githubRouter);
if ((0, githubConnection_js_1.isOAuthEnabled)()) {
    console.log("[server] GitHub OAuth routes registered");
}
// Health endpoint — used by uptime monitors to prevent free-tier cold starts
// Requirements: 11.4
app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
});
// ---- Global error handler ---------------------------------------------------
// Catches errors that propagate out of route handlers, including body-parser
// errors (entity.too.large → 413) that are not handled by individual routes.
// Requirements: 11.4
app.use((err, _req, res, _next) => {
    if (err !== null &&
        typeof err === "object" &&
        "type" in err &&
        err.type === "entity.too.large") {
        res.status(413).json({ error: "Payload too large" });
        return;
    }
    console.error("[server] Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
});
// ---- Start server ------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`[server] Listening on port ${PORT}`);
    if ((0, githubConnection_js_1.isOAuthEnabled)()) {
        console.log("[server] GitHub OAuth is ENABLED");
    }
});
//# sourceMappingURL=server.js.map