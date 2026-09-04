/**
 * Integration tests for GitHub OAuth routes.
 *
 * Tests:
 *   - GET /config returns { features: { githubOAuth: false } } when OAuth env vars are unset
 *   - GET /config returns { features: { githubOAuth: true } } when both env vars are set
 *
 * Requirements: 17.1, 17.2
 */

import { vi } from "vitest";

// ── Mock startup so validateEnvironment() is a no-op ─────────────────────────
vi.mock("../src/startup.js", () => ({
  validateEnvironment: vi.fn(),
}));

// ── Mock diagnoseBuild to prevent real LLM calls ──────────────────────────────
vi.mock("../src/llmClient.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/llmClient.js")>();
  return {
    ...original,
    diagnoseBuild: vi.fn().mockResolvedValue({
      category: "test-failure",
      explanation: "Test explanation.",
      suggestedFix: "Fix something.",
      confidence: "high",
    }),
  };
});

// ── Mock rate limiter (pass-through) ─────────────────────────────────────────
vi.mock("express-rate-limit", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

// ── /config endpoint behaviour ────────────────────────────────────────────────
//
// GET /config always delegates to isOAuthEnabled() at request time (not at
// module-load time), so we can test both branches in the same test file by
// manipulating process.env before each test and then importing/re-evaluating
// the relevant service function inline.
//
// Rather than fighting module caching to re-evaluate isOAuthEnabled(), we
// import the running Express app and hit GET /config directly — the handler
// calls isOAuthEnabled() live on every request, so env-var changes between
// tests are reflected immediately.

describe("GET /config", () => {
  let savedClientId: string | undefined;
  let savedClientSecret: string | undefined;

  beforeEach(() => {
    savedClientId = process.env.GITHUB_CLIENT_ID;
    savedClientSecret = process.env.GITHUB_CLIENT_SECRET;
  });

  afterEach(() => {
    if (savedClientId === undefined) {
      delete process.env.GITHUB_CLIENT_ID;
    } else {
      process.env.GITHUB_CLIENT_ID = savedClientId;
    }
    if (savedClientSecret === undefined) {
      delete process.env.GITHUB_CLIENT_SECRET;
    } else {
      process.env.GITHUB_CLIENT_SECRET = savedClientSecret;
    }
  });

  it("returns { features: { githubOAuth: false } } when both env vars are unset (Req 17.2)", async () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;

    // Import app after env vars are set; vitest isolates modules per file
    // so this import resolves within this test file's module registry.
    const { app } = await import("../src/server.js");

    const response = await request(app).get("/config").expect(200);

    expect(response.body).toMatchObject({
      features: { githubOAuth: false },
    });
  });

  it("returns { features: { githubOAuth: false } } when GITHUB_CLIENT_ID is unset (Req 17.2)", async () => {
    delete process.env.GITHUB_CLIENT_ID;
    process.env.GITHUB_CLIENT_SECRET = "some-secret";

    const { app } = await import("../src/server.js");

    const response = await request(app).get("/config").expect(200);

    expect(response.body).toMatchObject({
      features: { githubOAuth: false },
    });
  });

  it("returns { features: { githubOAuth: false } } when GITHUB_CLIENT_SECRET is unset (Req 17.2)", async () => {
    process.env.GITHUB_CLIENT_ID = "some-client-id";
    delete process.env.GITHUB_CLIENT_SECRET;

    const { app } = await import("../src/server.js");

    const response = await request(app).get("/config").expect(200);

    expect(response.body).toMatchObject({
      features: { githubOAuth: false },
    });
  });

  it("returns { features: { githubOAuth: true } } when both env vars are set (Req 17.1)", async () => {
    process.env.GITHUB_CLIENT_ID = "Iv1.test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";

    const { app } = await import("../src/server.js");

    const response = await request(app).get("/config").expect(200);

    expect(response.body).toMatchObject({
      features: { githubOAuth: true },
    });
  });
});
