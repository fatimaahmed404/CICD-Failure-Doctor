/**
 * Unit tests for validateWebhookRequest
 *
 * Covers:
 *   - Missing X-Webhook-Secret header → 401          (Req 9.4)
 *   - Empty X-Webhook-Secret header → 401            (Req 9.4)
 *   - Wrong X-Webhook-Secret value → 401             (Req 9.3)
 *   - Correct X-Webhook-Secret value → valid         (Req 9.3)
 *   - WEBHOOK_SECRET env var absent → 500            (Req 9.5)
 *   - WEBHOOK_SECRET env var empty string → 500      (Req 9.5)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Request } from "express";
import { validateWebhookRequest } from "../src/auth/validateWebhook.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Express-like Request mock with the given headers. */
function makeRequest(headers: Record<string, string> = {}): Request {
  return {
    headers: Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    ),
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Env-var lifecycle helpers — save/restore around each test
// ---------------------------------------------------------------------------

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.WEBHOOK_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.WEBHOOK_SECRET;
  } else {
    process.env.WEBHOOK_SECRET = originalSecret;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateWebhookRequest", () => {
  describe("when WEBHOOK_SECRET is not configured", () => {
    it("returns { valid: false, statusCode: 500 } when env var is absent (Req 9.5)", () => {
      delete process.env.WEBHOOK_SECRET;
      const req = makeRequest({ "x-webhook-secret": "anything" });

      const result = validateWebhookRequest(req);

      expect(result.valid).toBe(false);
      expect(result.statusCode).toBe(500);
    });

    it("returns { valid: false, statusCode: 500 } when env var is an empty string (Req 9.5)", () => {
      process.env.WEBHOOK_SECRET = "";
      const req = makeRequest({ "x-webhook-secret": "anything" });

      const result = validateWebhookRequest(req);

      expect(result.valid).toBe(false);
      expect(result.statusCode).toBe(500);
    });
  });

  describe("when WEBHOOK_SECRET is configured", () => {
    beforeEach(() => {
      process.env.WEBHOOK_SECRET = "super-secret-value";
    });

    it("returns { valid: false, statusCode: 401 } when X-Webhook-Secret header is absent (Req 9.4)", () => {
      const req = makeRequest(); // no header at all

      const result = validateWebhookRequest(req);

      expect(result.valid).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it("returns { valid: false, statusCode: 401 } when X-Webhook-Secret header is an empty string (Req 9.4)", () => {
      const req = makeRequest({ "x-webhook-secret": "" });

      const result = validateWebhookRequest(req);

      expect(result.valid).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it("returns { valid: false, statusCode: 401 } when X-Webhook-Secret has the wrong value (Req 9.3)", () => {
      const req = makeRequest({ "x-webhook-secret": "wrong-secret" });

      const result = validateWebhookRequest(req);

      expect(result.valid).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it("returns { valid: false, statusCode: 401 } when header is a prefix of the correct secret (Req 9.3)", () => {
      // Ensures length-mismatch doesn't accidentally validate
      const req = makeRequest({ "x-webhook-secret": "super-secret" });

      const result = validateWebhookRequest(req);

      expect(result.valid).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it("returns { valid: true, statusCode: null } when X-Webhook-Secret matches exactly (Req 9.3)", () => {
      const req = makeRequest({ "x-webhook-secret": "super-secret-value" });

      const result = validateWebhookRequest(req);

      expect(result.valid).toBe(true);
      expect(result.statusCode).toBeNull();
    });

    it("is case-sensitive: header value with different casing → 401 (Req 9.3)", () => {
      const req = makeRequest({ "x-webhook-secret": "Super-Secret-Value" });

      const result = validateWebhookRequest(req);

      expect(result.valid).toBe(false);
      expect(result.statusCode).toBe(401);
    });
  });
});
