/**
 * Webhook authentication helper.
 *
 * Validates the `X-Webhook-Secret` header on incoming requests.
 *
 * Phase 1: Look up the header value as a per-user webhook secret.
 *          If found, return { valid: true, userId: user.id, statusCode: null }.
 * Phase 2: Fall back to the global WEBHOOK_SECRET env var with timingSafeEqual.
 *          If matched, return { valid: true, userId: null, statusCode: null }.
 *
 * Return shape:
 *   { valid: true,  userId: string | null, statusCode: null }   — authenticated
 *   { valid: false, userId: null,          statusCode: 401 }    — header absent/wrong
 *   { valid: false, userId: null,          statusCode: 500 }    — WEBHOOK_SECRET not configured
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 1.2, 1.5
 */
import type { Request } from "express";
export interface WebhookValidationResult {
    valid: boolean;
    userId: string | null;
    statusCode: 401 | 500 | null;
}
/**
 * Validates that the incoming request carries a correct `X-Webhook-Secret`
 * header.  Checks per-user secrets first, then falls back to the global
 * WEBHOOK_SECRET environment variable with constant-time comparison (Req 9.3).
 */
export declare function validateWebhookRequest(req: Request): WebhookValidationResult;
//# sourceMappingURL=validateWebhook.d.ts.map