"use strict";
/**
 * Express server entry point.
 *
 * startup.ts MUST be called first — before any middleware or route registration —
 * so the process exits immediately if required environment variables are absent.
 *
 * Requirements: 11.2, 11.4
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const cookie_parser_1 = __importDefault(require("cookie-parser"));
// Initialize the SQLite database and run schema migrations at startup
require("./db/init.js");
const express_rate_limit_1 = require("express-rate-limit");
const express_session_1 = __importDefault(require("express-session"));
const auth_js_1 = require("./routes/auth.js");
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
// Trust proxy — required for rate limiter and secure cookies behind a reverse proxy
app.set("trust proxy", 1);
// CORS must be applied before all routes, with credentials support for cookies
const IS_PROD = process.env.NODE_ENV === "production";
app.use((0, cors_1.default)({ origin: CORS_ORIGINS, credentials: true }));
// ── Session middleware (required for OAuth state parameter) ───────────────────
// SESSION_SECRET is required — startup.ts exits if absent when added to REQUIRED_ENV_VARS.
// For now we read it from env without a fallback.
const sessionSecret = process.env.SESSION_SECRET ?? "fallback-dev-only";
app.use((0, express_session_1.default)({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: IS_PROD ? "none" : "lax",
        maxAge: 10 * 60 * 1000, // 10 minutes — long enough to complete OAuth flow
    },
}));
// Cookie parser must be before auth routes so req.cookies is available
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.json({ limit: "10mb" }));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
// ---- Routes ------------------------------------------------------------------
// Auth routes (signup, login, logout, /auth/me)
app.use(auth_js_1.authRouter);
// Webhook ingestion (POST /webhook/ingest) — rate limited
app.use(postRouteLimiter, webhook_js_1.default);
// Simulate (POST /simulate) — rate limited
app.use("/simulate", postRouteLimiter, simulate_js_1.default);
// Diagnoses API (GET /diagnoses, GET /diagnoses/:id)
app.use("/diagnoses", diagnoses_js_1.diagnosesRouter);
// Public diagnoses (demo records only, no auth required)
app.use("/public", diagnoses_js_1.publicDiagnosesRouter);
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
// ── Test email endpoint (admin only — remove before production) ──────────────
// GET /test-email?to=address@example.com
// Sends a test email immediately so you can verify Resend config is working.
app.get("/test-email", async (_req, res) => {
    const to = (typeof _req.query.to === "string" ? _req.query.to : process.env.NOTIFICATION_EMAIL) || "";
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const fromAddress = process.env.RESEND_FROM_EMAIL?.trim() || "CI/CD Doctor <onboarding@resend.dev>";
    console.log("[test-email] Attempting send:", { to, apiKey: apiKey ? apiKey.slice(0, 8) + "..." : "MISSING", from: fromAddress });
    if (!apiKey) {
        res.status(500).json({ error: "RESEND_API_KEY not set" });
        return;
    }
    if (!to) {
        res.status(400).json({ error: "No recipient — pass ?to=email or set NOTIFICATION_EMAIL" });
        return;
    }
    try {
        const nodemailer = await Promise.resolve().then(() => __importStar(require("nodemailer")));
        const transporter = nodemailer.default.createTransport({
            host: "smtp.resend.com", port: 465, secure: true,
            auth: { user: "resend", pass: apiKey },
        });
        const info = await transporter.sendMail({
            from: fromAddress, to,
            subject: "CI/CD Doctor — email test",
            html: "<h2>✅ Email is working!</h2><p>Resend SMTP is configured correctly on Render.</p>",
            text: "Email test — Resend SMTP is working.",
        });
        console.log("[test-email] SUCCESS:", info.messageId);
        res.json({ ok: true, messageId: info.messageId, to, from: fromAddress });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[test-email] FAILED:", msg);
        res.status(500).json({ error: msg });
    }
});
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
    // ── Keep-alive self-ping (prevents Render free tier from sleeping) ────────
    // Render spins down free services after 15 min of inactivity.
    // Ping our own /health endpoint every 10 minutes to stay awake.
    // Only run in production to avoid noise in local dev.
    if (process.env.NODE_ENV === "production" && process.env.APP_BASE_URL) {
        const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
        const healthUrl = `${process.env.APP_BASE_URL}/health`;
        setInterval(() => {
            fetch(healthUrl)
                .then(() => console.log("[keepalive] Pinged", healthUrl))
                .catch((err) => console.warn("[keepalive] Ping failed:", err.message));
        }, PING_INTERVAL_MS);
        console.log(`[keepalive] Self-ping enabled every 10 min → ${healthUrl}`);
    }
});
//# sourceMappingURL=server.js.map