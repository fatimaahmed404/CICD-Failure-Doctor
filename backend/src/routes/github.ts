/**
 * GitHub OAuth and repository connection routes.
 *
 * Route registration:
 *   GET  /config                  — always registered (feature flag endpoint)
 *   GET  /auth/github/login       — only when isOAuthEnabled() (Req 17.3)
 *   GET  /auth/github/callback    — only when isOAuthEnabled() (Req 17.4)
 *   GET  /github/repos            — only when isOAuthEnabled() (Req 17.6)
 *   POST /github/connect-repo     — only when isOAuthEnabled() (Req 17.8)
 *   DELETE /github/disconnect     — only when isOAuthEnabled() (Req 17.20)
 *
 * State management:
 *   The OAuth `state` parameter is stored in `req.session.oauthState` (express-session).
 *   The session augmentation below declares this field on the SessionData interface.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9,
 *               17.10, 17.15, 17.20
 */

import { randomBytes } from "crypto";
import { Router, type Request, type Response } from "express";
import type {} from "express-session"; // ensure session types are loaded

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
  getGitHubToken,
  deleteGitHubToken,
} from "../db/githubTokens.js";

import { encryptToken, decryptToken } from "../services/tokenEncryption.js";

// ── Session augmentation ──────────────────────────────────────────────────────
// Adds `oauthState` to express-session's SessionData so TypeScript accepts
// reading and writing it via `req.session.oauthState`.

declare module "express-session" {
  interface SessionData {
    oauthState: string | undefined;
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract and validate the X-Client-Id header.
 * Sends 400 and returns null when the header is absent or empty.
 */
function requireClientId(req: Request, res: Response): string | null {
  const header = req.headers["x-client-id"];
  if (!header || typeof header !== "string" || header.trim() === "") {
    res.status(400).json({ error: "Missing or empty X-Client-Id header" });
    return null;
  }
  return header.trim();
}

/**
 * Map GitHub service errors to the appropriate HTTP status codes.
 * Falls through to 500 for unexpected errors.
 */
function handleGitHubError(err: unknown, res: Response): void {
  if (err instanceof GitHubRateLimitError) {
    res.status(429).json({
      error: err.message,
      resetAt: err.resetTimestamp,
    });
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
// Always registered regardless of OAuth being enabled (Req 17.1, 17.2).

router.get("/config", (_req: Request, res: Response): void => {
  res.status(200).json({
    features: {
      githubOAuth: isOAuthEnabled(),
    },
  });
});

// ── OAuth routes — only registered when isOAuthEnabled() ─────────────────────

if (isOAuthEnabled()) {
  // ── GET /auth/github/login ──────────────────────────────────────────────
  /**
   * Generates a cryptographically random state value, stores it in the
   * user's session, then redirects the browser to GitHub's OAuth page.
   *
   * Requirement: 17.3
   */
  router.get("/auth/github/login", (req: Request, res: Response): void => {
    // 16 random bytes → 32 hex chars (Req 17.3: "16 hex bytes using crypto.randomBytes")
    const state = randomBytes(16).toString("hex");
    req.session.oauthState = state;

    const loginUrl = getLoginUrl(state);
    res.redirect(302, loginUrl);
  });

  // ── GET /auth/github/callback ───────────────────────────────────────────
  /**
   * Validates the returned state, exchanges the code for an access token,
   * encrypts and persists the token, then redirects back to the frontend.
   *
   * Requirements: 17.4, 17.5, 17.19
   */
  router.get(
    "/auth/github/callback",
    async (req: Request, res: Response): Promise<void> => {
      const { code, state } = req.query as {
        code?: string;
        state?: string;
      };

      // ── State validation (CSRF guard) — Req 17.4 ────────────────────────
      const storedState = req.session.oauthState;

      if (!state || !storedState || state !== storedState) {
        // Clear any stale state before responding
        req.session.oauthState = undefined;
        res.status(400).json({ error: "Invalid OAuth state parameter" });
        return;
      }

      // One-time use — clear after validation
      req.session.oauthState = undefined;

      if (!code) {
        // User denied the OAuth request
        const frontendUrl = buildFrontendUrl();
        res.redirect(`${frontendUrl}/?github_oauth=denied`);
        return;
      }

      // ── Determine redirect URI (must match what login used) ─────────────
      const redirectUri = getRedirectUri();

      try {
        // Exchange code for access token — Req 17.4
        const accessToken = await exchangeCode(code, redirectUri);

        // Fetch GitHub username (best-effort) — Req 17.19
        const username = await fetchGitHubUsername(accessToken);

        // Encrypt token before persisting — Req 17.5
        const encryptedToken = encryptToken(accessToken);

        // Determine clientId: prefer X-Client-Id header, generate UUID if absent
        const clientIdHeader = req.headers["x-client-id"];
        const clientId =
          typeof clientIdHeader === "string" && clientIdHeader.trim() !== ""
            ? clientIdHeader.trim()
            : generateClientId();

        // Persist encrypted token — Req 17.4, 17.5, 17.18
        upsertGitHubToken(clientId, encryptedToken, username);

        // Redirect back to the frontend with success signal — Req 17.4
        const frontendUrl = buildFrontendUrl();
        const params = new URLSearchParams({ connected: "true" });
        if (username) params.set("username", username);
        params.set("client_id", clientId);
        res.redirect(`${frontendUrl}/?${params.toString()}`);
      } catch (err) {
        console.error("[github/callback] Token exchange error:", err);
        const frontendUrl = buildFrontendUrl();
        res.redirect(`${frontendUrl}/?github_oauth=error`);
      }
    },
  );

  // ── GET /github/repos ───────────────────────────────────────────────────
  /**
   * Returns repositories where the authenticated user has push access.
   *
   * Requirements: 17.6, 17.7
   */
  router.get(
    "/github/repos",
    async (req: Request, res: Response): Promise<void> => {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      // Retrieve and decrypt stored token
      const record = getGitHubToken(clientId);
      if (!record) {
        res.status(401).json({
          error: "No GitHub account connected. Please connect your account first.",
        });
        return;
      }

      let accessToken: string;
      try {
        accessToken = decryptToken(record.encryptedToken);
      } catch {
        res.status(401).json({
          error: "Stored token could not be decrypted. Please reconnect your account.",
        });
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

  // ── POST /github/connect-repo ───────────────────────────────────────────
  /**
   * Connects a repository by creating secrets and adding a workflow file.
   *
   * Requirements: 17.8, 17.9, 17.10, 17.14, 17.15
   */
  router.post(
    "/github/connect-repo",
    async (req: Request, res: Response): Promise<void> => {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      const body = req.body as { repoFullName?: string };
      const repoFullName = body.repoFullName?.trim();
      if (!repoFullName) {
        res.status(400).json({ error: "Missing or empty repoFullName field" });
        return;
      }

      // Retrieve and decrypt stored token
      const record = getGitHubToken(clientId);
      if (!record) {
        res.status(401).json({
          error: "No GitHub account connected. Please connect your account first.",
        });
        return;
      }

      let accessToken: string;
      try {
        accessToken = decryptToken(record.encryptedToken);
      } catch {
        res.status(401).json({
          error: "Stored token could not be decrypted. Please reconnect your account.",
        });
        return;
      }

      try {
        const result = await connectRepo(accessToken, repoFullName);

        if ("success" in result) {
          // Full success — Req 17.8
          const success = result as ConnectRepoSuccess;
          res.status(200).json(success);
        } else {
          // Partial success: secrets created, workflow file failed — Req 17.9
          const partial = result as ConnectRepoPartial;
          res.status(207).json(partial);
        }
      } catch (err) {
        handleGitHubError(err, res);
      }
    },
  );

  // ── DELETE /github/disconnect ───────────────────────────────────────────
  /**
   * Removes the stored OAuth token for the client (disconnect flow).
   *
   * Requirement: 17.20
   */
  router.delete(
    "/github/disconnect",
    (req: Request, res: Response): void => {
      const clientId = requireClientId(req, res);
      if (!clientId) return;

      deleteGitHubToken(clientId);
      res.status(200).json({ success: true });
    },
  );
}

// ── Private helpers ───────────────────────────────────────────────────────────

/** Resolve the frontend base URL for post-OAuth redirects.
 *
 * Priority:
 *   1. FRONTEND_URL env var (set this in production — Vercel URL)
 *   2. Local dev heuristic: replace :3000 with :5173
 */
function buildFrontendUrl(): string {
  if (process.env.FRONTEND_URL && process.env.FRONTEND_URL.trim() !== "") {
    return process.env.FRONTEND_URL.trim();
  }
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return base.includes(":3000") ? base.replace(":3000", ":5173") : base;
}

/** Build the redirect URI that was used when constructing the login URL. */
function getRedirectUri(): string {
  if (process.env.GITHUB_REDIRECT_URI) return process.env.GITHUB_REDIRECT_URI;
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return `${base}/auth/github/callback`;
}

/**
 * Generate a new random UUID v4 for clients that don't send X-Client-Id.
 * This matches the UUID v4 pattern used elsewhere in the app.
 */
function generateClientId(): string {
  // Use the uuid package pattern: 8-4-4-4-12 hex chars with version bits set
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant bits
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export { router as githubRouter };
