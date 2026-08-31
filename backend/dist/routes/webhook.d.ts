/**
 * POST /webhook/ingest
 *
 * Receives failed build payloads from GitHub Actions or Jenkins, authenticates
 * the request via the shared `X-Webhook-Secret` header, validates the payload,
 * and enqueues an async diagnosis job.
 *
 * Response codes:
 *   202 — accepted, record persisted and job enqueued
 *   400 — validation failure (missing/blank fields, bad commitSha or source)
 *   401 — missing or incorrect X-Webhook-Secret header
 *   413 — payload exceeds 10 MB
 *   500 — server misconfiguration (WEBHOOK_SECRET env var not set)
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=webhook.d.ts.map