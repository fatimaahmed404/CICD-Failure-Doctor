/**
 * Authentication service.
 *
 * Provides password hashing/verification (bcrypt) and JWT sign/verify helpers.
 * SESSION_SECRET must be set in environment before calling signToken/verifyToken.
 */

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { AuthenticatedUser } from "../types.js";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(userId: string, email: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("[authService] SESSION_SECRET is not set");
  return jwt.sign({ sub: userId, email }, secret, { expiresIn: "7d" });
}

interface JwtPayload {
  sub: string;
  email: string;
}

export function verifyToken(token: string): AuthenticatedUser | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret) as JwtPayload;
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
