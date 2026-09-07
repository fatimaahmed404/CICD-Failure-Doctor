/**
 * requireAuth middleware.
 *
 * Reads the `auth_token` cookie, verifies it, and attaches the decoded
 * user to `req.user`. Returns 401 when the cookie is absent or invalid.
 */
import type { Request, Response, NextFunction } from "express";
declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
export default requireAuth;
//# sourceMappingURL=requireAuth.d.ts.map