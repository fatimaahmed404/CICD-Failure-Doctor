"use strict";
/**
 * GitHub OAuth and repository connection routes.
 *
 * These routes are registered ONLY when both GITHUB_CLIENT_ID and
 * GITHUB_CLIENT_SECRET are set to non-empty values.
 *
 * Routes:
 *   GET  /auth/github/login        — Redirect to GitHub OAuth (Req 17.3)
 *   GET  /auth/github/callback     — Handle OAuth callback (Req 17.4)
 *   GET  /github/repos             — List accessible repos (Req 17.6)
 *   POST /github/connect-repo      — Connect a repo (Req 17.8)
 *   DELETE /github/disconnect      — Disconnect GitHub account (Req 17.20)
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9,
 *               17.10, 17.14, 17.15, 17.19, 17.20
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.githubRouter = void 0;
const express_1 = require("express");
const githubConnectionService_js_1 = require("../services/githubConnectionService.js");
const githubTokens_js_1 = require("../db/githubTokens.js");
const router = (0, express_1.Router)();
exports.githubRouter = router;
// ── Helper: extract and validate X-Client-Id header ──────────────────────────
function getClientId(req, res) {
    const clientId = req.headers["x-client-id"];
    if (!clientId || typeof clientId !== "string" || clientId.trim() === "") {
        res.status(400).json({ error: "Missing or empty X-Client-Id header" });
        return null;
    }
    return clientId.trim();
}
// ── Helper: handle GitHub API typed errors ────────────────────────────────────
function handleServiceError(err, res) {
    if (err instanceof githubConnectionService_js_1.GitHubRateLimitError) {
        res.status(429).json({
            error: err.message,
            rateLimitReset: err.resetTimestamp,
        });
        return;
    }
    if (err instanceof githubConnectionService_js_1.InvalidTokenError) {
        res.status(401).json({ error: err.message });
        return;
    }
    if (err instanceof githubConnectionService_js_1.InsufficientPermissionsError) {
        res.status(403).json({ error: err.message });
        return;
    }
    if (err instanceof githubConnectionService_js_1.TokenNotFoundError) {
        res.status(401).json({
            error: "No GitHub account connected. Please complete the OAuth flow.",
        });
        return;
    }
    console.error("[github routes] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
}
// ── GET /auth/github/login ────────────────────────────────────────────────────
/**
 * Initiates the GitHub OAuth flow by redirecting to the authorization URL.
 * Requires X-Client-Id header to associate the state with the caller.
 *
 * Requirement: 17.3
 */
router.get("/auth/github/login", (req, res) => {
    // Client ID can come from header OR from query param (browser redirect case)
    let clientId = req.headers["x-client-id"] ??
        req.query["client_id"];
    if (!clientId || clientId.trim() === "") {
        res.status(400).json({
            error: "Missing X-Client-Id header or client_id query parameter",
        });
        return;
    }
    clientId = clientId.trim();
    const authUrl = (0, githubConnectionService_js_1.buildAuthorizationUrl)(clientId);
    res.redirect(302, authUrl);
});
// ── GET /auth/github/callback ─────────────────────────────────────────────────
/**
 * Handles the GitHub OAuth callback.
 * Validates state, exchanges code for token, stores encrypted token.
 *
 * Requirement: 17.4
 */
router.get("/auth/github/callback", async (req, res) => {
    const { code, state, client_id } = req.query;
    // State validation (Req 17.4)
    if (!state || !client_id) {
        res.status(400).json({ error: "Missing state or client_id parameter" });
        return;
    }
    if (!(0, githubConnectionService_js_1.validateOAuthState)(client_id, state)) {
        res.status(400).json({ error: "Invalid or expired OAuth state parameter" });
        return;
    }
    if (!code) {
        // User denied the OAuth request
        const frontendBase = process.env.APP_BASE_URL?.replace(":3000", ":5173") ?? "http://localhost:5173";
        res.redirect(`${frontendBase}/?github_oauth=denied`);
        return;
    }
    try {
        const { githubUsername } = await (0, githubConnectionService_js_1.exchangeCodeForToken)(code, client_id);
        // Redirect back to frontend with success signal
        const frontendBase = process.env.APP_BASE_URL?.replace(":3000", ":5173") ?? "http://localhost:5173";
        const params = new URLSearchParams({ github_oauth: "success", client_id });
        if (githubUsername)
            params.set("username", githubUsername);
        res.redirect(`${frontendBase}/?${params.toString()}`);
    }
    catch (err) {
        console.error("[github/callback] Token exchange error:", err);
        const frontendBase = process.env.APP_BASE_URL?.replace(":3000", ":5173") ?? "http://localhost:5173";
        res.redirect(`${frontendBase}/?github_oauth=error`);
    }
});
// ── GET /github/repos ─────────────────────────────────────────────────────────
/**
 * Returns repos where the authenticated user has push access.
 * Requirement: 17.6
 */
router.get("/github/repos", async (req, res) => {
    const clientId = getClientId(req, res);
    if (!clientId)
        return;
    try {
        const repos = await (0, githubConnectionService_js_1.listUserRepos)(clientId);
        res.status(200).json(repos);
    }
    catch (err) {
        handleServiceError(err, res);
    }
});
// ── POST /github/connect-repo ─────────────────────────────────────────────────
/**
 * Connects a repository by creating secrets and a workflow file.
 * Requirements: 17.8, 17.9, 17.10
 */
router.post("/github/connect-repo", async (req, res) => {
    const clientId = getClientId(req, res);
    if (!clientId)
        return;
    const { repoFullName } = req.body;
    if (!repoFullName || typeof repoFullName !== "string" || repoFullName.trim() === "") {
        res.status(400).json({ error: "Missing or empty repoFullName field" });
        return;
    }
    try {
        const result = await (0, githubConnectionService_js_1.connectRepository)(clientId, repoFullName.trim());
        if ("partialSuccess" in result) {
            // Req 17.9: secrets created but workflow failed
            res.status(207).json({
                secretsCreated: result.secretsCreated,
                workflowError: result.workflowError,
                repoFullName: result.repoFullName,
                manualSetupUrl: result.manualSetupUrl,
                message: "Repository secrets were created but the workflow file could not be added. " +
                    "Please follow the manual setup instructions to complete the integration.",
            });
            return;
        }
        res.status(200).json(result);
    }
    catch (err) {
        handleServiceError(err, res);
    }
});
// ── DELETE /github/disconnect ─────────────────────────────────────────────────
/**
 * Disconnects the GitHub account by deleting the stored token.
 * Requirement: 17.20
 */
router.delete("/github/disconnect", (req, res) => {
    const clientId = getClientId(req, res);
    if (!clientId)
        return;
    (0, githubConnectionService_js_1.disconnectGitHub)(clientId);
    res.status(200).json({ success: true });
});
// ── GET /github/status ────────────────────────────────────────────────────────
/**
 * Returns the connection status and GitHub username for the current client.
 * Used by the frontend to check if a token is already stored.
 */
router.get("/github/status", (req, res) => {
    const clientId = getClientId(req, res);
    if (!clientId)
        return;
    const record = (0, githubTokens_js_1.getGitHubToken)(clientId);
    if (!record) {
        res.status(200).json({ connected: false });
        return;
    }
    res.status(200).json({
        connected: true,
        githubUsername: record.githubUsername,
    });
});
//# sourceMappingURL=github.js.map