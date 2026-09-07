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
declare module "express-session" {
    interface SessionData {
        oauthState: string | undefined;
    }
}
declare const router: import("express-serve-static-core").Router;
export { router as githubRouter };
//# sourceMappingURL=github.d.ts.map