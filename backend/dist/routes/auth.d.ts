/**
 * Auth routes.
 *
 * POST /auth/signup  — create account, set auth_token cookie
 * POST /auth/login   — verify credentials, set auth_token cookie
 * POST /auth/logout  — clear auth_token cookie
 * GET  /auth/me      — return current user info (requires auth)
 *
 * Requirements: auth feature
 */
declare const router: import("express-serve-static-core").Router;
export { router as authRouter };
//# sourceMappingURL=auth.d.ts.map