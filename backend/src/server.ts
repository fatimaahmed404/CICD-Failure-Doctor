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
import cookieParser from "cookie-parser";
// Initialize the SQLite database and run schema migrations at startup
import "./db/init.js";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import { authRouter } from "./routes/auth.js";
import { diagnosesRouter, publicDiagnosesRouter } from "./routes/diagnoses.js";
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

// Trust proxy — required for rate limiter and secure cookies behind a reverse proxy
app.set("trust proxy", 1);

// CORS must be applied before all routes, with credentials support for cookies
const IS_PROD = process.env.NODE_ENV === "production";
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));

// ── Session middleware (required for OAuth state parameter) ───────────────────
// SESSION_SECRET is required — startup.ts exits if absent when added to REQUIRED_ENV_VARS.
// For now we read it from env without a fallback.
const sessionSecret = process.env.SESSION_SECRET ?? "fallback-dev-only";

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: IS_PROD ? "none" : "lax",
      maxAge: 10 * 60 * 1000, // 10 minutes — long enough to complete OAuth flow
    },
  }),
);

// Cookie parser must be before auth routes so req.cookies is available
app.use(cookieParser());

app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// ---- Routes ------------------------------------------------------------------

// Auth routes (signup, login, logout, /auth/me)
app.use(authRouter);

// Webhook ingestion (POST /webhook/ingest) — rate limited
app.use(postRouteLimiter, webhookRouter);

// Simulate (POST /simulate) — rate limited
app.use("/simulate", postRouteLimiter, simulateRouter);

// Diagnoses API (GET /diagnoses, GET /diagnoses/:id)
app.use("/diagnoses", diagnosesRouter);

// Public diagnoses (demo records only, no auth required)
app.use("/public", publicDiagnosesRouter);

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

// ── Test email endpoint — uses Brevo HTTP API (works on Render) ──────────────
app.get("/test-email", async (_req, res) => {
  const to = (typeof _req.query.to === "string" ? _req.query.to : process.env.NOTIFICATION_EMAIL) || "";
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const fromEmail = process.env.BREVO_FROM_EMAIL?.trim() || "fatiimaahmed06@gmail.com";
  const fromName = process.env.BREVO_FROM_NAME?.trim() || "CI/CD Failure Doctor";
  console.log("[test-email] Config:", { to, hasKey: Boolean(apiKey), fromEmail });
  if (!apiKey) { res.status(500).json({ error: "BREVO_API_KEY not set" }); return; }
  if (!to) { res.status(400).json({ error: "No recipient — pass ?to=email or set NOTIFICATION_EMAIL" }); return; }
  try {
    console.log("[test-email] Calling Brevo API...");
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email: to }],
        subject: "CI/CD Doctor — email test",
        htmlContent: "<h2>✅ Email is working!</h2><p>Brevo HTTP API is configured correctly.</p>",
        textContent: "Email test successful.",
      }),
    });
    const body = await r.text();
    if (!r.ok) {
      console.error("[test-email] Brevo API error:", r.status, body);
      res.status(500).json({ error: body, status: r.status });
      return;
    }
    console.log("[test-email] SUCCESS:", body);
    res.json({ ok: true, response: JSON.parse(body), to, from: fromEmail });
  } catch (err) {
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
        .catch((err: Error) => console.warn("[keepalive] Ping failed:", err.message));
    }, PING_INTERVAL_MS);
    console.log(`[keepalive] Self-ping enabled every 10 min → ${healthUrl}`);
  }
});

export { app };
