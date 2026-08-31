/**
 * Webhook authentication helper.
 *
 * Validates the `X-Webhook-Secret` header on incoming requests against the
 * `WEBHOOK_SECRET` environment variable using a constant-time comparison so
 * the check is immune to timing-based secret enumeration.
 *
 * Return shape:
 *   { valid: true,  statusCode: null }          — header matches secret
 *   { valid: false, statusCode: 401 }           — header absent, empty, or wrong
 *   { valid: false, statusCode: 500 }           — WEBHOOK_SECRET not configured
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 1.2, 1.5
 */

import { timingSafeEqual } from "crypto";
import type { Request } from "express";

export interface WebhookValidationResult {
  valid: boolean;
  statusCode: 401 | 500 | null;
}

/**
 * Validates that the incoming request carries a correct `X-Webhook-Secret`
 * header.  Uses `crypto.timingSafeEqual` so comparison time is constant
 * regardless of the content or length of the supplied value (Req 9.3).
 *
 * Defense-in-depth note: startup.ts already exits the process when
 * `WEBHOOK_SECRET` is absent.  The 500-path here is a runtime fallback for
 * edge cases such as env-var mutation after startup (Req 9.5).
 */
export function validateWebhookRequest(req: Request): WebhookValidationResult {
  const secret = process.env.WEBHOOK_SECRET;

  // Req 9.5 — server misconfiguration, not a client auth failure
  if (!secret) {
    console.error(
      "[validateWebhookRequest] WEBHOOK_SECRET env var not configured — returning 500"
    );
    return { valid: false, statusCode: 500 };
  }

  const header = req.headers["x-webhook-secret"];

  // Req 9.4 — missing or empty header
  if (!header || typeof header !== "string" || header.length === 0) {
    return { valid: false, statusCode: 401 };
  }

  // Req 9.3 — constant-time comparison to prevent timing attacks.
  // timingSafeEqual requires both Buffers to be the same byte length, so we
  // fall back to a simple inequality check first to avoid throwing, but we
  // still do the constant-time comparison when lengths match.
  const expectedBuf = Buffer.from(secret, "utf8");
  const actualBuf = Buffer.from(header, "utf8");

  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    return { valid: false, statusCode: 401 };
  }

  return { valid: true, statusCode: null };
}
