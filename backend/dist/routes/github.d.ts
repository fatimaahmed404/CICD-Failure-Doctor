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
declare module "express-session" {
    interface SessionData {
        oauthState: string | undefined;
    }
}
declare const router: import("express-serve-static-core").Router;
export { router as githubRouter };
//# sourceMappingURL=github.d.ts.map