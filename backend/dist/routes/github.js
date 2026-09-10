"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.githubRouter = void 0;
const crypto_1 = require("crypto");
const express_1 = require("express");
const githubConnection_js_1 = require("../services/githubConnection.js");
const githubTokens_js_1 = require("../db/githubTokens.js");
const tokenEncryption_js_1 = require("../services/tokenEncryption.js");
const requireAuth_js_1 = __importDefault(require("../auth/requireAuth.js"));
const authService_js_1 = require("../auth/authService.js");
const users_js_1 = require("../db/users.js");
// ── Router ────────────────────────────────────────────────────────────────────
const router = (0, express_1.Router)();
exports.githubRouter = router;
// ── Error handler ─────────────────────────────────────────────────────────────
function handleGitHubError(err, res) {
    if (err instanceof githubConnection_js_1.GitHubRateLimitError) {
        res.status(429).json({ error: err.message, resetAt: err.resetTimestamp });
        return;
    }
    if (err instanceof githubConnection_js_1.GitHubAuthError) {
        res.status(401).json({ error: err.message });
        return;
    }
    if (err instanceof githubConnection_js_1.GitHubPermissionError) {
        res.status(403).json({ error: err.message });
        return;
    }
    console.error("[github routes] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
}
// ── GET /config ───────────────────────────────────────────────────────────────
router.get("/config", (_req, res) => {
    res.status(200).json({ features: { githubOAuth: (0, githubConnection_js_1.isOAuthEnabled)() } });
});
// ── OAuth routes ──────────────────────────────────────────────────────────────
if ((0, githubConnection_js_1.isOAuthEnabled)()) {
    // GET /auth/github/login — generate state, store in session, redirect to GitHub
    router.get("/auth/github/login", (req, res) => {
        const state = (0, crypto_1.randomBytes)(16).toString("hex");
        req.session.oauthState = state;
        res.redirect(302, (0, githubConnection_js_1.getLoginUrl)(state));
    });
    // GET /auth/github/callback — exchange code, persist token, redirect to frontend
    router.get("/auth/github/callback", async (req, res) => {
        const { code, state } = req.query;
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
            const accessToken = await (0, githubConnection_js_1.exchangeCode)(code, getRedirectUri());
            const username = await (0, githubConnection_js_1.fetchGitHubUsername)(accessToken);
            const encryptedToken = (0, tokenEncryption_js_1.encryptToken)(accessToken);
            // Associate the token with the authenticated user if a valid session cookie is present.
            // The callback arrives as a browser redirect so requireAuth is not applied here —
            // we read the cookie manually with verifyToken (non-throwing).
            // We also verify the userId exists in the users table to avoid FK constraint failures
            // (can happen if the DB was reset between sessions while the JWT is still valid).
            const authCookie = req.cookies?.auth_token;
            const tokenUserId = authCookie ? ((0, authService_js_1.verifyToken)(authCookie)?.userId ?? null) : null;
            const userId = tokenUserId ? ((0, users_js_1.getUserById)(tokenUserId) ? tokenUserId : null) : null;
            // clientId is kept for legacy redirect params only
            const clientId = generateClientId();
            (0, githubTokens_js_1.upsertGitHubToken)(clientId, encryptedToken, username, userId);
            const params = new URLSearchParams({ connected: "true" });
            if (username)
                params.set("username", username);
            params.set("client_id", clientId);
            res.redirect(`${buildFrontendUrl()}/?${params.toString()}`);
        }
        catch (err) {
            console.error("[github/callback] Token exchange error:", err);
            res.redirect(`${buildFrontendUrl()}/?github_oauth=error`);
        }
    });
    // GET /github/repos — list repos for the authenticated user
    router.get("/github/repos", requireAuth_js_1.default, async (req, res) => {
        const userId = req.user.userId;
        const record = (0, githubTokens_js_1.getGitHubTokenByUserId)(userId);
        if (!record) {
            res.status(401).json({ error: "No GitHub account connected. Please connect your account first." });
            return;
        }
        let accessToken;
        try {
            accessToken = (0, tokenEncryption_js_1.decryptToken)(record.encryptedToken);
        }
        catch {
            res.status(401).json({ error: "Stored token could not be decrypted. Please reconnect your account." });
            return;
        }
        try {
            const repos = await (0, githubConnection_js_1.listRepos)(accessToken);
            res.status(200).json({ repos });
        }
        catch (err) {
            handleGitHubError(err, res);
        }
    });
    // POST /github/connect-repo — create repo secrets + workflow file
    router.post("/github/connect-repo", requireAuth_js_1.default, async (req, res) => {
        const userId = req.user.userId;
        const body = req.body;
        const repoFullName = body.repoFullName?.trim();
        if (!repoFullName) {
            res.status(400).json({ error: "Missing or empty repoFullName field" });
            return;
        }
        const record = (0, githubTokens_js_1.getGitHubTokenByUserId)(userId);
        if (!record) {
            res.status(401).json({ error: "No GitHub account connected. Please connect your account first." });
            return;
        }
        let accessToken;
        try {
            accessToken = (0, tokenEncryption_js_1.decryptToken)(record.encryptedToken);
        }
        catch {
            res.status(401).json({ error: "Stored token could not be decrypted. Please reconnect your account." });
            return;
        }
        // Use the user's personal webhook secret so their CI pipelines are
        // attributed to their account (not the shared app-level secret).
        const userRecord = (0, users_js_1.getUserById)(userId);
        const userWebhookSecret = userRecord?.webhookSecret ?? process.env.WEBHOOK_SECRET ?? "";
        try {
            const result = await (0, githubConnection_js_1.connectRepo)(accessToken, repoFullName, userWebhookSecret);
            if ("success" in result) {
                res.status(200).json(result);
            }
            else {
                // Map backend field names to what the frontend expects
                const partial = result;
                console.error("[connectRepo] Partial success — workflow file failed:", partial.error);
                res.status(207).json({
                    secretsCreated: true,
                    workflowError: partial.error,
                    repoFullName,
                    manualSetupUrl: partial.manualSetupUrl,
                    message: `Repository secrets were created but the workflow file could not be added automatically. Error: ${partial.error}`,
                });
            }
        }
        catch (err) {
            handleGitHubError(err, res);
        }
    });
    // DELETE /github/disconnect — remove stored OAuth token
    router.delete("/github/disconnect", requireAuth_js_1.default, (req, res) => {
        (0, githubTokens_js_1.deleteGitHubTokenByUserId)(req.user.userId);
        res.status(200).json({ success: true });
    });
}
// ── Private helpers ───────────────────────────────────────────────────────────
function buildFrontendUrl() {
    if (process.env.FRONTEND_URL?.trim())
        return process.env.FRONTEND_URL.trim();
    const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
    return base.includes(":3000") ? base.replace(":3000", ":5173") : base;
}
function getRedirectUri() {
    if (process.env.GITHUB_REDIRECT_URI)
        return process.env.GITHUB_REDIRECT_URI;
    const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
    return `${base}/auth/github/callback`;
}
function generateClientId() {
    const bytes = (0, crypto_1.randomBytes)(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}
//# sourceMappingURL=github.js.map