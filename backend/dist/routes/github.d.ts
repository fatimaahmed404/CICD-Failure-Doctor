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
declare const router: import("express-serve-static-core").Router;
export { router as githubRouter };
//# sourceMappingURL=github.d.ts.map