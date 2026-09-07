/**
 * User data-access functions.
 *
 * Handles creation and lookup of user records.
 * Webhook secrets are generated per-user at signup.
 */

import { db } from "./init.js";
import { randomBytes, randomUUID } from "crypto";
import type { UserRecord } from "../types.js";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  webhook_secret: string;
  created_at: number;
}

export class UserValidationError extends Error {
  public readonly field: string;
  constructor(message: string, field: string) {
    super(message);
    this.name = "UserValidationError";
    this.field = field;
  }
}

function rowToDomain(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    webhookSecret: row.webhook_secret,
    createdAt: row.created_at,
  };
}

export function insertUser(email: string, passwordHash: string): UserRecord {
  const id = randomUUID();
  const webhookSecret = randomBytes(32).toString("hex");
  const createdAt = Date.now();
  try {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, webhook_secret, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, email, passwordHash, webhookSecret, createdAt);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      throw new UserValidationError("Email already in use", "email");
    }
    throw err;
  }
  return { id, email, passwordHash, webhookSecret, createdAt };
}

export function getUserByEmail(email: string): UserRecord | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  return row ? rowToDomain(row) : null;
}

export function getUserById(id: string): UserRecord | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? rowToDomain(row) : null;
}

export function getUserByWebhookSecret(webhookSecret: string): UserRecord | null {
  const row = db.prepare("SELECT * FROM users WHERE webhook_secret = ?").get(webhookSecret) as UserRow | undefined;
  return row ? rowToDomain(row) : null;
}
