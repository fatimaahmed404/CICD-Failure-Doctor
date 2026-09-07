/**
 * requireAuth middleware.
 *
 * Reads the `auth_token` cookie, verifies it, and attaches the decoded
 * user to `req.user`. Returns 401 when the cookie is absent or invalid.
 */

import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "./authService.js";

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token: string | undefined = req.cookies?.auth_token;
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.user = user;
  next();
}

export default requireAuth;
