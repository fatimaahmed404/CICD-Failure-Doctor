"use strict";
/**
 * requireAuth middleware.
 *
 * Reads the `auth_token` cookie, verifies it, and attaches the decoded
 * user to `req.user`. Returns 401 when the cookie is absent or invalid.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const authService_js_1 = require("./authService.js");
function requireAuth(req, res, next) {
    const token = req.cookies?.auth_token;
    if (!token) {
        res.status(401).json({ error: "Authentication required" });
        return;
    }
    const user = (0, authService_js_1.verifyToken)(token);
    if (!user) {
        res.status(401).json({ error: "Authentication required" });
        return;
    }
    req.user = user;
    next();
}
exports.default = requireAuth;
//# sourceMappingURL=requireAuth.js.map