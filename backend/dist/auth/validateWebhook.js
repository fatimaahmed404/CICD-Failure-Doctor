"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWebhookRequest = validateWebhookRequest;
const crypto_1 = require("crypto");
const users_js_1 = require("../db/users.js");
/**
 * Validates that the incoming request carries a correct `X-Webhook-Secret`
 * header.  Checks per-user secrets first, then falls back to the global
 * WEBHOOK_SECRET environment variable with constant-time comparison (Req 9.3).
 */
function validateWebhookRequest(req) {
    const header = req.headers["x-webhook-secret"];
    // Req 9.4 — missing or empty header
    if (!header || typeof header !== "string" || header.length === 0) {
        return { valid: false, userId: null, statusCode: 401 };
    }
    // Phase 1: per-user webhook secret lookup
    const user = (0, users_js_1.getUserByWebhookSecret)(header);
    if (user) {
        return { valid: true, userId: user.id, statusCode: null };
    }
    // Phase 2: fall back to global WEBHOOK_SECRET with constant-time comparison
    const secret = process.env.WEBHOOK_SECRET;
    // Req 9.5 — server misconfiguration
    if (!secret) {
        console.error("[validateWebhookRequest] WEBHOOK_SECRET env var not configured — returning 500");
        return { valid: false, userId: null, statusCode: 500 };
    }
    // Req 9.3 — constant-time comparison to prevent timing attacks.
    const expectedBuf = Buffer.from(secret, "utf8");
    const actualBuf = Buffer.from(header, "utf8");
    if (expectedBuf.length !== actualBuf.length ||
        !(0, crypto_1.timingSafeEqual)(expectedBuf, actualBuf)) {
        return { valid: false, userId: null, statusCode: 401 };
    }
    return { valid: true, userId: null, statusCode: null };
}
//# sourceMappingURL=validateWebhook.js.map