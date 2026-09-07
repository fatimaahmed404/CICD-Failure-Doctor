"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authService_js_1 = require("../auth/authService.js");
const requireAuth_js_1 = __importDefault(require("../auth/requireAuth.js"));
const users_js_1 = require("../db/users.js");
const router = (0, express_1.Router)();
exports.authRouter = router;
// ── Cookie options ─────────────────────────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === "production";
const COOKIE_OPTIONS = {
    httpOnly: true,
    sameSite: (IS_PROD ? "none" : "lax"),
    secure: IS_PROD,
    maxAge: 7 * 24 * 60 * 60 * 1000,
};
// ── Zod schemas ────────────────────────────────────────────────────────────────
const credentialsSchema = zod_1.z.object({
    email: zod_1.z.string().email("Invalid email address"),
    password: zod_1.z.string().min(8, "Password must be at least 8 characters"),
});
// ── POST /auth/signup ─────────────────────────────────────────────────────────
router.post("/auth/signup", async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
        return;
    }
    const { email, password } = parsed.data;
    try {
        const passwordHash = await (0, authService_js_1.hashPassword)(password);
        const user = (0, users_js_1.insertUser)(email, passwordHash);
        const token = (0, authService_js_1.signToken)(user.id, user.email);
        res.cookie("auth_token", token, COOKIE_OPTIONS);
        res.status(201).json({ id: user.id, email: user.email, webhookSecret: user.webhookSecret });
    }
    catch (err) {
        if (err instanceof users_js_1.UserValidationError && err.field === "email") {
            res.status(409).json({ error: "Email already in use" });
            return;
        }
        throw err;
    }
});
// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post("/auth/login", async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
        return;
    }
    const { email, password } = parsed.data;
    const user = (0, users_js_1.getUserByEmail)(email);
    if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
    }
    const valid = await (0, authService_js_1.verifyPassword)(password, user.passwordHash);
    if (!valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
    }
    const token = (0, authService_js_1.signToken)(user.id, user.email);
    res.cookie("auth_token", token, COOKIE_OPTIONS);
    res.status(200).json({ id: user.id, email: user.email, webhookSecret: user.webhookSecret });
});
// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post("/auth/logout", (_req, res) => {
    res.clearCookie("auth_token", {
        httpOnly: true,
        sameSite: (IS_PROD ? "none" : "lax"),
        secure: IS_PROD,
    });
    res.status(200).json({ message: "Logged out" });
});
// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get("/auth/me", requireAuth_js_1.default, (req, res) => {
    const userId = req.user.userId;
    const user = (0, users_js_1.getUserById)(userId);
    if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
    }
    res.status(200).json({ id: user.id, email: user.email, webhookSecret: user.webhookSecret });
});
//# sourceMappingURL=auth.js.map