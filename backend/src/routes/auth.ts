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

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { hashPassword, verifyPassword, signToken } from "../auth/authService.js";
import requireAuth from "../auth/requireAuth.js";
import { insertUser, getUserByEmail, getUserById, UserValidationError } from "../db/users.js";

const router = Router();

// ── Cookie options ─────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === "production";
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: (IS_PROD ? "none" : "lax") as "none" | "lax",
  secure: IS_PROD,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// ── Zod schemas ────────────────────────────────────────────────────────────────

const credentialsSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// ── POST /auth/signup ─────────────────────────────────────────────────────────

router.post("/auth/signup", async (req: Request, res: Response): Promise<void> => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const passwordHash = await hashPassword(password);
    const user = insertUser(email, passwordHash);
    const token = signToken(user.id, user.email);
    res.cookie("auth_token", token, COOKIE_OPTIONS);
    res.status(201).json({ id: user.id, email: user.email, webhookSecret: user.webhookSecret });
  } catch (err) {
    if (err instanceof UserValidationError && err.field === "email") {
      res.status(409).json({ error: "Email already in use" });
      return;
    }
    throw err;
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────

router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { email, password } = parsed.data;
  const user = getUserByEmail(email);

  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = signToken(user.id, user.email);
  res.cookie("auth_token", token, COOKIE_OPTIONS);
  res.status(200).json({ id: user.id, email: user.email, webhookSecret: user.webhookSecret });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────

router.post("/auth/logout", (_req: Request, res: Response): void => {
  res.clearCookie("auth_token", {
    httpOnly: true,
    sameSite: (IS_PROD ? "none" : "lax") as "none" | "lax",
    secure: IS_PROD,
  });
  res.status(200).json({ message: "Logged out" });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────

router.get("/auth/me", requireAuth, (req: Request, res: Response): void => {
  const userId = req.user!.userId;
  const user = getUserById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.status(200).json({ id: user.id, email: user.email, webhookSecret: user.webhookSecret });
});

export { router as authRouter };
