/**
 * Integration tests for all API routes.
 *
 * Uses Supertest against the Express `app` exported from server.ts.
 * An in-memory SQLite database is used to isolate tests from each other.
 *
 * The startup.ts env-var guard runs on import of server.ts, so we mock
 * startup.ts to prevent process.exit(1). We also mock express-rate-limit
 * so tests are never rate-limited.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.6, 1.7, 2.1, 2.2, 7.1–7.7
 */

import { vi } from "vitest";

// ── Mock startup so validateEnvironment() is a no-op ─────────────────────────
// (vi.mock is hoisted above all code, including process.env assignments)
vi.mock("../src/startup.js", () => ({
  validateEnvironment: vi.fn(),
}));

// ── Mock diagnoseBuild so no real LLM calls are made ─────────────────────────
vi.mock("../src/llmClient.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/llmClient.js")>();
  return {
    ...original,
    // Inline literal — vi.mock factories are hoisted so no outer variable refs
    diagnoseBuild: vi.fn().mockResolvedValue({
      category: "test-failure",
      explanation: "Tests failed due to assertion errors.",
      suggestedFix: "Fix the assertion in the test.",
      confidence: "high",
    }),
  };
});

// Mock the rate limiter so it never blocks our test requests
vi.mock("express-rate-limit", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

// ── Database setup: in-memory SQLite shared across the app ───────────────────
// The DATABASE_PATH=":memory:" env var (set in setup.integration.ts) causes
// db/init.ts to open an in-memory database, which is used by all data-access
// functions throughout the test suite.

import { db } from "../src/db/init.js";
import type { Database as DatabaseType } from "better-sqlite3";

function resetDatabase(): void {
  // Wipe all rows between tests to give each test a clean slate
  (db as unknown as DatabaseType).exec("DELETE FROM build_records;");
}

// Import the app AFTER mocking
import { app } from "../src/server.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_COMMIT_SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

const VALID_WEBHOOK_BODY = {
  log: "Error: Tests failed\nSome test output",
  repoName: "org/my-repo",
  jobName: "CI / test",
  commitSha: VALID_COMMIT_SHA,
  source: "github",
  branch: "main",
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(() => {
  // Database is initialised as part of init.ts import; nothing extra needed.
});

beforeEach(() => {
  resetDatabase();
});

afterAll(() => {
  // Close the database connection after all tests
  try {
    (db as unknown as import("better-sqlite3").Database).close();
  } catch {
    // ignore if already closed
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. POST /webhook/ingest
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /webhook/ingest", () => {
  it(
    "202 — valid request with correct secret returns { id, status: 'pending' } (Req 1.1)",
    async () => {
      const res = await request(app)
        .post("/webhook/ingest")
        .set("X-Webhook-Secret", "test-secret")
        .send(VALID_WEBHOOK_BODY);

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        status: "pending",
      });
      // id should look like a UUID v4
      expect(res.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    },
  );

  it(
    "401 — missing X-Webhook-Secret header (Req 1.2, 9.4)",
    async () => {
      const res = await request(app)
        .post("/webhook/ingest")
        .send(VALID_WEBHOOK_BODY);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    },
  );

  it(
    "401 — wrong X-Webhook-Secret header value (Req 1.2, 9.3)",
    async () => {
      const res = await request(app)
        .post("/webhook/ingest")
        .set("X-Webhook-Secret", "wrong-secret")
        .send(VALID_WEBHOOK_BODY);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    },
  );

  it(
    "400 — missing required field 'log' returns error with details (Req 1.3)",
    async () => {
      const { log: _omitted, ...bodyWithoutLog } = VALID_WEBHOOK_BODY;

      const res = await request(app)
        .post("/webhook/ingest")
        .set("X-Webhook-Secret", "test-secret")
        .send(bodyWithoutLog);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body).toHaveProperty("details");
      expect(Array.isArray(res.body.details)).toBe(true);
    },
  );

  it(
    "400 — missing required field 'repoName' returns details listing repoName (Req 1.3)",
    async () => {
      const { repoName: _omitted, ...bodyWithoutRepoName } = VALID_WEBHOOK_BODY;

      const res = await request(app)
        .post("/webhook/ingest")
        .set("X-Webhook-Secret", "test-secret")
        .send(bodyWithoutRepoName);

      expect(res.status).toBe(400);
      expect(
        res.body.details.some((d: string) => /repoName/i.test(d)),
      ).toBe(true);
    },
  );

  it(
    "400 — invalid commitSha (too short) returns details listing commitSha (Req 1.3)",
    async () => {
      const res = await request(app)
        .post("/webhook/ingest")
        .set("X-Webhook-Secret", "test-secret")
        .send({ ...VALID_WEBHOOK_BODY, commitSha: "abc123" });

      expect(res.status).toBe(400);
      expect(
        res.body.details.some((d: string) => /commitSha/i.test(d)),
      ).toBe(true);
    },
  );

  it(
    "400 — invalid source 'gitlab' returns error with details (Req 1.7)",
    async () => {
      const res = await request(app)
        .post("/webhook/ingest")
        .set("X-Webhook-Secret", "test-secret")
        .send({ ...VALID_WEBHOOK_BODY, source: "gitlab" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body).toHaveProperty("details");
    },
  );

  it(
    "400 — source 'GitHub' (wrong case) is rejected (Req 1.7)",
    async () => {
      const res = await request(app)
        .post("/webhook/ingest")
        .set("X-Webhook-Secret", "test-secret")
        .send({ ...VALID_WEBHOOK_BODY, source: "GitHub" });

      expect(res.status).toBe(400);
    },
  );

  it(
    "413 — oversized payload (> 10 MB) is rejected (Req 1.6)",
    async () => {
      // Generate a payload just over 10 MB
      const bigLog = "x".repeat(11 * 1024 * 1024);

      const res = await request(app)
        .post("/webhook/ingest")
        .set("X-Webhook-Secret", "test-secret")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ ...VALID_WEBHOOK_BODY, log: bigLog }));

      expect(res.status).toBe(413);
      expect(res.body).toHaveProperty("error");
    },
  );

  it(
    "202 — no BuildRecord is persisted on 401 (Req 1.2)",
    async () => {
      await request(app)
        .post("/webhook/ingest")
        .send(VALID_WEBHOOK_BODY); // no secret header

      // Confirm no record was written
      const listRes = await request(app).get("/diagnoses");
      expect(listRes.body.total).toBe(0);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. POST /simulate
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /simulate", () => {
  it(
    "202 — valid scenario returns { id, scenario, status: 'pending' } (Req 2.1)",
    async () => {
      const res = await request(app)
        .post("/simulate")
        .send({ scenario: "test-failure" });

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        scenario: "test-failure",
        status: "pending",
      });
    },
  );

  it(
    "202 — 'dependency-error' scenario is accepted (Req 2.1, 2.4)",
    async () => {
      const res = await request(app)
        .post("/simulate")
        .send({ scenario: "dependency-error" });

      expect(res.status).toBe(202);
      expect(res.body.scenario).toBe("dependency-error");
    },
  );

  it(
    "202 — 'docker-build-failure' scenario is accepted (Req 2.1, 2.4)",
    async () => {
      const res = await request(app)
        .post("/simulate")
        .send({ scenario: "docker-build-failure" });

      expect(res.status).toBe(202);
    },
  );

  it(
    "202 — 'env-var-missing' scenario is accepted (Req 2.1, 2.4)",
    async () => {
      const res = await request(app)
        .post("/simulate")
        .send({ scenario: "env-var-missing" });

      expect(res.status).toBe(202);
    },
  );

  it(
    "202 — 'timeout' scenario is accepted (Req 2.1, 2.4)",
    async () => {
      const res = await request(app)
        .post("/simulate")
        .send({ scenario: "timeout" });

      expect(res.status).toBe(202);
    },
  );

  it(
    "202 — 'lint-error' scenario is accepted (Req 2.1, 2.4)",
    async () => {
      const res = await request(app)
        .post("/simulate")
        .send({ scenario: "lint-error" });

      expect(res.status).toBe(202);
    },
  );

  it(
    "400 — invalid scenario value returns error with details (Req 2.2)",
    async () => {
      const res = await request(app)
        .post("/simulate")
        .send({ scenario: "not-a-real-scenario" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body).toHaveProperty("details");
      expect(Array.isArray(res.body.details)).toBe(true);
    },
  );

  it(
    "202 — no body defaults to 'test-failure' scenario (Req 2.3)",
    async () => {
      const res = await request(app).post("/simulate").send({});

      expect(res.status).toBe(202);
      expect(res.body.scenario).toBe("test-failure");
    },
  );

  it(
    "202 — null scenario also defaults to 'test-failure' (Req 2.3)",
    async () => {
      const res = await request(app)
        .post("/simulate")
        .send({ scenario: null });

      expect(res.status).toBe(202);
      expect(res.body.scenario).toBe("test-failure");
    },
  );

  it(
    "202 — empty string scenario defaults to 'test-failure' (Req 2.3)",
    async () => {
      const res = await request(app)
        .post("/simulate")
        .send({ scenario: "" });

      expect(res.status).toBe(202);
      expect(res.body.scenario).toBe("test-failure");
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET /diagnoses
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /diagnoses", () => {
  it(
    "200 — returns paginated response shape { data, total, page, pageSize } with defaults (Req 7.1, 7.2)",
    async () => {
      const res = await request(app).get("/diagnoses");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array),
        total: expect.any(Number),
        page: 1,
        pageSize: 20,
      });
    },
  );

  it(
    "200 — inserts several records and verifies pagination counts (Req 7.1, 7.5)",
    async () => {
      // Insert 3 records via /simulate
      for (let i = 0; i < 3; i++) {
        await request(app).post("/simulate").send({ scenario: "lint-error" });
      }

      const res = await request(app).get("/diagnoses?page=1&limit=2");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(2);
      expect(res.body.data).toHaveLength(2);
    },
  );

  it(
    "200 — limit is capped at 100 (Req 7.2)",
    async () => {
      const res = await request(app).get("/diagnoses?limit=999");

      expect(res.status).toBe(200);
      expect(res.body.pageSize).toBe(100);
    },
  );

  it(
    "200 — category filter returns only matching records (Req 7.2)",
    async () => {
      // Insert a record via webhook with source=github
      await request(app)
        .post("/webhook/ingest")
        .set("X-Webhook-Secret", "test-secret")
        .send({
          ...VALID_WEBHOOK_BODY,
          commitSha: "b".repeat(40),
        });

      const res = await request(app).get(
        "/diagnoses?category=test-failure",
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
    },
  );

  it(
    "200 — out-of-range page returns empty data array with correct total (Req 7.6)",
    async () => {
      // Insert 2 records
      await request(app).post("/simulate").send({ scenario: "timeout" });
      await request(app).post("/simulate").send({ scenario: "timeout" });

      // Page 999 is far beyond any data
      const res = await request(app).get("/diagnoses?page=999&limit=20");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(999);
    },
  );

  it(
    "400 — invalid category query param is rejected (Req 7.7)",
    async () => {
      const res = await request(app).get(
        "/diagnoses?category=not-a-valid-category",
      );

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    },
  );

  it(
    "200 — results are sorted by createdAt descending (most recent first) (Req 7.5)",
    async () => {
      await request(app).post("/simulate").send({ scenario: "test-failure" });
      await request(app).post("/simulate").send({ scenario: "lint-error" });

      const res = await request(app).get("/diagnoses?limit=5");

      expect(res.status).toBe(200);
      const dates = res.body.data.map(
        (r: { createdAt: string }) => new Date(r.createdAt).getTime(),
      );
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
      }
    },
  );

  it(
    "200 — each DiagnosisSummary has the expected shape fields (Req 7.1)",
    async () => {
      await request(app).post("/simulate").send({ scenario: "test-failure" });

      const res = await request(app).get("/diagnoses");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);

      const summary = res.body.data[0];
      expect(summary).toHaveProperty("id");
      expect(summary).toHaveProperty("repoName");
      expect(summary).toHaveProperty("jobName");
      expect(summary).toHaveProperty("commitSha");
      expect(summary).toHaveProperty("source");
      expect(summary).toHaveProperty("status");
      expect(summary).toHaveProperty("createdAt");
      // explanation in summary is first sentence only (or null)
      expect("explanation" in summary).toBe(true);
      // suggestedFix should NOT be present in list summary
      expect(summary).not.toHaveProperty("suggestedFix");
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GET /diagnoses/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /diagnoses/:id", () => {
  it(
    "200 — existing record returns full DiagnosisDetail with all fields (Req 7.3)",
    async () => {
      // Create a record via simulate
      const postRes = await request(app)
        .post("/simulate")
        .send({ scenario: "test-failure" });

      const { id } = postRes.body;

      const res = await request(app).get(`/diagnoses/${id}`);

      expect(res.status).toBe(200);
      // DiagnosisDetail fields
      expect(res.body).toHaveProperty("id", id);
      expect(res.body).toHaveProperty("repoName");
      expect(res.body).toHaveProperty("jobName");
      expect(res.body).toHaveProperty("commitSha");
      expect(res.body).toHaveProperty("source", "simulate");
      expect(res.body).toHaveProperty("status");
      expect(res.body).toHaveProperty("createdAt");
      // Detail-specific fields
      expect(res.body).toHaveProperty("suggestedFix");
      expect(res.body).toHaveProperty("rawLog");
      expect(res.body).toHaveProperty("truncated");
    },
  );

  it(
    "200 — rawLog field is non-empty in DiagnosisDetail (Req 7.3)",
    async () => {
      const postRes = await request(app)
        .post("/simulate")
        .send({ scenario: "test-failure" });

      const res = await request(app).get(`/diagnoses/${postRes.body.id}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.rawLog).toBe("string");
      expect(res.body.rawLog.length).toBeGreaterThan(0);
    },
  );

  it(
    "404 — unknown ID returns { error: 'Not found' } (Req 7.4)",
    async () => {
      const res = await request(app).get(
        "/diagnoses/00000000-0000-0000-0000-000000000000",
      );

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    },
  );

  it(
    "404 — completely invalid ID string returns 404 (Req 7.4)",
    async () => {
      const res = await request(app).get("/diagnoses/not-a-real-id");

      expect(res.status).toBe(404);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GET /health
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /health", () => {
  it("200 — returns { status: 'ok' }", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. End-to-end: POST /simulate → poll GET /diagnoses → verify status="complete"
// ═══════════════════════════════════════════════════════════════════════════════

describe("E2E: simulate → diagnose → complete", () => {
  it(
    "POST /simulate creates a pending record that transitions to 'complete' (Req 2.1, 2.5, 3.1, 3.2)",
    async () => {
      // Step 1 — trigger simulation
      const simRes = await request(app)
        .post("/simulate")
        .send({ scenario: "test-failure" });

      expect(simRes.status).toBe(202);
      const { id } = simRes.body;
      expect(typeof id).toBe("string");

      // Step 2 — poll until status changes from "pending" (the mocked LLM
      // resolves immediately, so one extra tick is enough)
      const MAX_POLLS = 20;
      const POLL_INTERVAL_MS = 50;

      let finalRecord: {
        status: string;
        category: string | null;
        explanation: string | null;
        confidence: string | null;
        suggestedFix: string | null;
      } | null = null;

      for (let i = 0; i < MAX_POLLS; i++) {
        const pollRes = await request(app).get(`/diagnoses/${id}`);
        expect(pollRes.status).toBe(200);

        if (pollRes.body.status !== "pending") {
          finalRecord = pollRes.body;
          break;
        }

        // Small delay before next poll
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      // Step 3 — verify the record reached status="complete" with the mocked
      // DiagnosisResult fields populated
      expect(finalRecord).not.toBeNull();
      expect(finalRecord!.status).toBe("complete");
      expect(finalRecord!.category).toBe("test-failure");
      expect(finalRecord!.confidence).toBe("high");
      // explanation may be first-sentence truncated in list view; full in detail
      expect(typeof finalRecord!.explanation).toBe("string");
      expect((finalRecord!.explanation ?? "").length).toBeGreaterThan(0);
    },
    10_000, // allow up to 10 seconds for the async job to complete
  );

  it(
    "POST /simulate record also appears in GET /diagnoses list after completion (Req 7.1)",
    async () => {
      const simRes = await request(app)
        .post("/simulate")
        .send({ scenario: "dependency-error" });

      const { id } = simRes.body;

      // Wait for the job to complete (same polling strategy)
      for (let i = 0; i < 20; i++) {
        const detailRes = await request(app).get(`/diagnoses/${id}`);
        if (detailRes.body.status !== "pending") break;
        await new Promise((r) => setTimeout(r, 50));
      }

      // Verify the record appears in the list
      const listRes = await request(app).get("/diagnoses");
      expect(listRes.status).toBe(200);
      const ids = listRes.body.data.map((r: { id: string }) => r.id);
      expect(ids).toContain(id);
    },
    10_000,
  );
});
