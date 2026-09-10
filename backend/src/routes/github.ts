/**
 * GitHub OAuth and repository connection routes.
 *
 * Route registration:
 *   GET  /config                  — always registered (feature flag endpoint)
 *   GET  /auth/github/login       — only when isOAuthEnabled()
 *   GET  /auth/github/callback    — only when isOAuthEnabled()
 *   GET  /github/repos            — only when isOAuthEnabled() (requireAuth)
 *   POST /github/connect-repo     — only when isOAuthEnabled() (requireAuth)
 *   DELETE /github/disconnect     — only when isOAuthEnabled() (requireAuth)
 *
 * Auth: all protected routes use the auth_token httpOnly cookie set by the
 * auth routes. X-Client-Id header is no longer used.
 *
 * Requirements: 17.1–17.10, 17.15, 17.19, 17.20, 18.7, 18.9
 */

import { randomBytes } from "crypto";
import { Router, type Request, type Response } from "express";
import type {} from "express-session";

import {
  isOAuthEnabled,
  getLoginUrl,
  exchangeCode,
  fetchGitHubUsername,
  listRepos,
  connectRepo,
  GitHubAuthError,
  GitHubRateLimitError,
  GitHubPermissionError,
  type ConnectRepoSuccess,
  type ConnectRepoPartial,
} from "../services/githubConnection.js";

import {
  upsertGitHubToken,
  getGitHubTokenByUserId,
  deleteGitHubTokenByUserId,
} from "../db/githubTokens.js";

import { encryptToken, decryptToken } from "../services/tokenEncryption.js";
import requireAuth from "../auth/requireAuth.js";
import { verifyToken } from "../auth/authService.js";
import { getUserById } from "../db/users.js";

// ── Session augmentation ──────────────────────────────────────────────────────

declare module "express-session" {
  interface SessionData {
    oauthState: string | undefined;
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// ── Error handler ─────────────────────────────────────────────────────────────

function handleGitHubError(err: unknown, res: Response): void {
  if (err instanceof GitHubRateLimitError) {
    res.status(429).json({ error: err.message, resetAt: err.resetTimestamp });
    return;
  }
  if (err instanceof GitHubAuthError) {
    res.status(401).json({ error: err.message });
    return;
  }
  if (err instanceof GitHubPermissionError) {
    res.status(403).json({ error: err.message });
    return;
  }
  console.error("[github routes] Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
}

// ── GET /config ───────────────────────────────────────────────────────────────

router.get("/config", (_req: Request, res: Response): void => {
  res.status(200).json({ features: { githubOAuth: isOAuthEnabled() } });
});

// ── OAuth routes ──────────────────────────────────────────────────────────────

if (isOAuthEnabled()) {

  // GET /auth/github/login — generate state, store in session, redirect to GitHub
  router.get("/auth/github/login", (req: Request, res: Response): void => {
    const state = randomBytes(16).toString("hex");
    req.session.oauthState = state;
    res.redirect(302, getLoginUrl(state));
  });

  // GET /auth/github/callback — exchange code, persist token, redirect to frontend
  router.get(
    "/auth/github/callback",
    async (req: Request, res: Response): Promise<void> => {
      const { code, state } = req.query as { code?: string; state?: string };
      const storedState = req.session.oauthState;

      // CSRF guard
      if (!state || !storedState || state !== storedState) {
        req.session.oauthState = undefined;
        res.status(400).json({ error: "Invalid OAuth state parameter" });
        return;
      }
      req.session.oauthState = undefined;

      if (!code) {
        res.redirect(`${buildFrontendUrl()}/?github_oauth=denied`);
        return;
      }

      try {
        const accessToken = await exchangeCode(code, getRedirectUri());
        const username = await fetchGitHubUsername(accessToken);
        const encryptedToken = encryptToken(accessToken);

        // Associate the token with the authenticated user if a valid session cookie is present.
        // The callback arrives as a browser redirect so requireAuth is not applied here —
        // we read the cookie manually with verifyToken (non-throwing).
        // We also verify the userId exists in the users table to avoid FK constraint failures
        // (can happen if the DB was reset between sessions while the JWT is still valid).
        const authCookie: string | undefined = req.cookies?.auth_token;
        const tokenUserId = authCookie ? (verifyToken(authCookie)?.userId ?? null) : null;
        const userId = tokenUserId ? (getUserById(tokenUserId) ? tokenUserId : null) : null;

        // clientId is kept for legacy redirect params only
        const clientId = generateClientId();
        upsertGitHubToken(clientId, encryptedToken, username, userId);

        const params = new URLSearchParams({ connected: "true" });
        if (username) params.set("username", username);
        params.set("client_id", clientId);
        res.redirect(`${buildFrontendUrl()}/?${params.toString()}`);
      } catch (err) {
        console.error("[github/callback] Token exchange error:", err);
        res.redirect(`${buildFrontendUrl()}/?github_oauth=error`);
      }
    },
  );

  // GET /github/repos — list repos for the authenticated user
  router.get(
    "/github/repos",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const userId = req.user!.userId;

      const record = getGitHubTokenByUserId(userId);
      if (!record) {
        res.status(401).json({ error: "No GitHub account connected. Please connect your account first." });
        return;
      }

      let accessToken: string;
      try {
        accessToken = decryptToken(record.encryptedToken);
      } catch {
        res.status(401).json({ error: "Stored token could not be decrypted. Please reconnect your account." });
        return;
      }

      try {
        const repos = await listRepos(accessToken);
        res.status(200).json({ repos });
      } catch (err) {
        handleGitHubError(err, res);
      }
    },
  );

  // POST /github/connect-repo — create repo secrets + workflow file
  router.post(
    "/github/connect-repo",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const userId = req.user!.userId;

      const body = req.body as { repoFullName?: string };
      const repoFullName = body.repoFullName?.trim();
      if (!repoFullName) {
        res.status(400).json({ error: "Missing or empty repoFullName field" });
        return;
      }

      const record = getGitHubTokenByUserId(userId);
      if (!record) {
        res.status(401).json({ error: "No GitHub account connected. Please connect your account first." });
        return;
      }

      let accessToken: string;
      try {
        accessToken = decryptToken(record.encryptedToken);
      } catch {
        res.status(401).json({ error: "Stored token could not be decrypted. Please reconnect your account." });
        return;
      }

      // Use the user's personal webhook secret so their CI pipelines are
      // attributed to their account (not the shared app-level secret).
      const userRecord = getUserById(userId);
      const userWebhookSecret = userRecord?.webhookSecret ?? process.env.WEBHOOK_SECRET ?? "";

      try {
        const result = await connectRepo(accessToken, repoFullName, userWebhookSecret);

        if ("success" in result) {
          res.status(200).json(result as ConnectRepoSuccess);
        } else {
          // Map backend field names to what the frontend expects
          const partial = result as ConnectRepoPartial;
          console.error("[connectRepo] Partial success — workflow file failed:", partial.error);
          res.status(207).json({
            secretsCreated: true,
            workflowError: partial.error,
            repoFullName,
            manualSetupUrl: partial.manualSetupUrl,
            message: `Repository secrets were created but the workflow file could not be added automatically. Error: ${partial.error}`,
          });
        }
      } catch (err) {
        handleGitHubError(err, res);
      }
    },
  );

  // DELETE /github/disconnect — remove stored OAuth token
  router.delete(
    "/github/disconnect",
    requireAuth,
    (req: Request, res: Response): void => {
      deleteGitHubTokenByUserId(req.user!.userId);
      res.status(200).json({ success: true });
    },
  );
}

// ── Private helpers ───────────────────────────────────────────────────────────

function buildFrontendUrl(): string {
  if (process.env.FRONTEND_URL?.trim()) return process.env.FRONTEND_URL.trim();
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return base.includes(":3000") ? base.replace(":3000", ":5173") : base;
}

function getRedirectUri(): string {
  if (process.env.GITHUB_REDIRECT_URI) return process.env.GITHUB_REDIRECT_URI;
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return `${base}/auth/github/callback`;
}

function generateClientId(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20,32)].join("-");
}

export { router as githubRouter };
