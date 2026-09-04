/**
 * Express server entry point.
 *
 * startup.ts MUST be called first — before any middleware or route registration —
 * so the process exits immediately if required environment variables are absent.
 *
 * Requirements: 11.2, 11.4
 */

// ---- Boot-time guard (must be first) ----------------------------------------
import { validateEnvironment } from "./startup.js";
import "dotenv/config";
validateEnvironment();

// ---- Dependencies ------------------------------------------------------------
import express from "express";
import cors from "cors";
import { randomBytes } from "crypto";
// Initialize the SQLite database and run schema migrations at startup
import "./db/init.js";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import { diagnosesRouter } from "./routes/diagnoses.js";
import webhookRouter from "./routes/webhook.js";
import simulateRouter from "./routes/simulate.js";
import { feedbackRouter } from "./routes/feedback.js";
import { githubRouter } from "./routes/github.js";
import { isOAuthEnabled } from "./services/githubConnection.js";

// ---- CORS configuration ------------------------------------------------------
const CORS_ORIGINS = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : ["http://localhost:5173",
    "https://cicd-failure-doctor-frontend.vercel.app"];

// ---- Rate limiter (task 11.2) ------------------------------------------------
// Applied only to POST /webhook/ingest and POST /simulate.
// 20 requests per minute per IP; exceeding the limit returns 429.
// Requirements: security considerations (design doc)
const postRouteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,  // emit RateLimit-* headers (RFC draft 7)
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

// ---- App setup ---------------------------------------------------------------
const app = express();

// CORS must be applied before all routes
app.use(cors({ origin: CORS_ORIGINS }));

// ── Session middleware (required for OAuth state parameter) ───────────────────
// SESSION_SECRET should be set in production. If absent, a random secret is
// generated so the server still starts, but sessions won't persist across restarts.
const sessionSecret = (() => {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim() !== "") {
    return process.env.SESSION_SECRET.trim();
  }
  const fallback = randomBytes(32).toString("hex");
  console.warn(
    "[startup] SESSION_SECRET not set — sessions will not persist across restarts",
  );
  return fallback;
})();

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000, // 10 minutes — long enough to complete OAuth flow
    },
  }),
);

app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// ---- Routes ------------------------------------------------------------------
// Webhook ingestion (POST /webhook/ingest) — rate limited
app.use(postRouteLimiter, webhookRouter);

// Simulate (POST /simulate) — rate limited
app.use("/simulate", postRouteLimiter, simulateRouter);

// Diagnoses API (GET /diagnoses, GET /diagnoses/:id)
app.use("/diagnoses", diagnosesRouter);

// Feedback API (POST /diagnoses/:id/feedback mounted via feedbackRouter)
// GET /feedback/stats
app.use("/feedback", feedbackRouter);

// Also mount feedback POST route under /diagnoses/:id/feedback
app.use("/diagnoses", feedbackRouter);

// ── GitHub OAuth routes (includes /config, /auth/github/*, /github/*) ─────────
// githubRouter always exposes GET /config.
// All OAuth-specific routes (/auth/github/login, /auth/github/callback,
// /github/repos, /github/connect-repo, /github/disconnect) are self-gated
// inside the router by isOAuthEnabled() — they are only registered when both
// GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set.
// Requirements: 17.1, 17.2
app.use(githubRouter);

if (isOAuthEnabled()) {
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
app.use(
  (
    err: unknown,
    _req: import("express").Request,
    res: import("express").Response,
    _next: import("express").NextFunction,
  ) => {
    if (
      err !== null &&
      typeof err === "object" &&
      "type" in err &&
      (err as { type: string }).type === "entity.too.large"
    ) {
      res.status(413).json({ error: "Payload too large" });
      return;
    }
    console.error("[server] Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  },
);

// ---- Start server ------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  if (isOAuthEnabled()) {
    console.log("[server] GitHub OAuth is ENABLED");
  }
});

export { app };
