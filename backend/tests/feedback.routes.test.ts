/**
 * Integration tests for feedback API routes (stretch feature).
 *
 * Tests POST /diagnoses/:id/feedback and GET /feedback/stats
 *
 * Requirements: 13.2, 13.3, 13.4
 */

import { vi } from "vitest";

// ── Mock startup so validateEnvironment() is a no-op ─────────────────────────
vi.mock("../src/startup.js", () => ({
  validateEnvironment: vi.fn(),
}));

// ── Mock diagnoseBuild so no real LLM calls are made ─────────────────────────
vi.mock("../src/llmClient.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/llmClient.js")>();
  return {
    ...original,
    diagnoseBuild: vi.fn().mockResolvedValue({
      category: "test-failure",
      explanation: "Tests failed due to assertion errors.",
      suggestedFix: "Fix the assertion in the test.",
      confidence: "high",
    }),
  };
});

// Mock the rate limiter
vi.mock("express-rate-limit", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { db } from "../src/db/init.js";
import type { Database as DatabaseType } from "better-sqlite3";
import { app } from "../src/server.js";
import { v4 as uuidv4 } from "uuid";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetDatabase(): void {
  (db as unknown as DatabaseType).exec("DELETE FROM feedback;");
  (db as unknown as DatabaseType).exec("DELETE FROM build_records;");
}

function createBuildRecord(overrides: Record<string, unknown> = {}): string {
  const id = uuidv4();
  const stmt = (db as unknown as DatabaseType).prepare(`
    INSERT INTO build_records (
      id, repo_name, job_name, commit_sha, source, raw_log,
      status, truncated, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    id,
    overrides.repoName || "test/repo",
    overrides.jobName || "CI / test",
    overrides.commitSha || "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    overrides.source || "github",
    overrides.rawLog || "test log",
    overrides.status || "complete",
    overrides.truncated || 0,
    overrides.createdAt || new Date().toISOString()
  );
  
  return id;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  resetDatabase();
});

afterAll(() => {
  try {
    (db as unknown as DatabaseType).close();
  } catch {
    // ignore if already closed
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /diagnoses/:id/feedback
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /diagnoses/:id/feedback", () => {
  it("should accept valid feedback with helpful rating", async () => {
    const buildRecordId = createBuildRecord();
    const clientId = uuidv4();

    const response = await request(app)
      .post(`/diagnoses/${buildRecordId}/feedback`)
      .set("X-Client-Id", clientId)
      .send({ rating: "helpful" })
      .expect(200);

    expect(response.body).toMatchObject({
      buildRecordId,
      clientId,
      rating: "helpful",
    });
    expect(response.body.id).toBeDefined();
    expect(response.body.createdAt).toBeDefined();
  });

  it("should accept valid feedback with unhelpful rating", async () => {
    const buildRecordId = createBuildRecord();
    const clientId = uuidv4();

    const response = await request(app)
      .post(`/diagnoses/${buildRecordId}/feedback`)
      .set("X-Client-Id", clientId)
      .send({ rating: "unhelpful" })
      .expect(200);

    expect(response.body).toMatchObject({
      buildRecordId,
      clientId,
      rating: "unhelpful",
    });
  });

  it("should upsert feedback — second rating replaces first", async () => {
    const buildRecordId = createBuildRecord();
    const clientId = uuidv4();

    // Submit first rating
    await request(app)
      .post(`/diagnoses/${buildRecordId}/feedback`)
      .set("X-Client-Id", clientId)
      .send({ rating: "helpful" })
      .expect(200);

    // Submit second rating (should replace)
    const response = await request(app)
      .post(`/diagnoses/${buildRecordId}/feedback`)
      .set("X-Client-Id", clientId)
      .send({ rating: "unhelpful" })
      .expect(200);

    expect(response.body.rating).toBe("unhelpful");

    // Verify only one row exists
    const rows = (db as unknown as DatabaseType)
      .prepare("SELECT * FROM feedback WHERE build_record_id = ? AND client_id = ?")
      .all(buildRecordId, clientId);
    expect(rows).toHaveLength(1);
  });

  it("should return 400 when X-Client-Id header is missing", async () => {
    const buildRecordId = createBuildRecord();

    const response = await request(app)
      .post(`/diagnoses/${buildRecordId}/feedback`)
      .send({ rating: "helpful" })
      .expect(400);

    expect(response.body.error).toContain("X-Client-Id");
  });

  it("should return 400 when X-Client-Id header is empty", async () => {
    const buildRecordId = createBuildRecord();

    const response = await request(app)
      .post(`/diagnoses/${buildRecordId}/feedback`)
      .set("X-Client-Id", "")
      .send({ rating: "helpful" })
      .expect(400);

    expect(response.body.error).toContain("X-Client-Id");
  });

  it("should return 400 when rating is invalid (Req 13.4)", async () => {
    const buildRecordId = createBuildRecord();
    const clientId = uuidv4();

    const response = await request(app)
      .post(`/diagnoses/${buildRecordId}/feedback`)
      .set("X-Client-Id", clientId)
      .send({ rating: "invalid-value" })
      .expect(400);

    expect(response.body.error).toBe("Invalid rating value");
  });

  it("should return 400 when rating is missing", async () => {
    const buildRecordId = createBuildRecord();
    const clientId = uuidv4();

    const response = await request(app)
      .post(`/diagnoses/${buildRecordId}/feedback`)
      .set("X-Client-Id", clientId)
      .send({})
      .expect(400);

    expect(response.body.error).toContain("rating");
  });

  it("should return 400 when diagnosis does not exist", async () => {
    const nonExistentId = uuidv4();
    const clientId = uuidv4();

    const response = await request(app)
      .post(`/diagnoses/${nonExistentId}/feedback`)
      .set("X-Client-Id", clientId)
      .send({ rating: "helpful" })
      .expect(400);

    expect(response.body.error).toContain("not found");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /feedback/stats
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /feedback/stats", () => {
  it("should return all 7 categories with zero counts when no feedback exists (Req 13.3)", async () => {
    const response = await request(app)
      .get("/feedback/stats")
      .expect(200);

    expect(response.body.stats).toHaveLength(7);
    
    const categories = response.body.stats.map((s: any) => s.category);
    expect(categories).toContain("dependency-build-error");
    expect(categories).toContain("test-failure");
    expect(categories).toContain("docker-build-failure");
    expect(categories).toContain("env-var-secrets");
    expect(categories).toContain("timeout-infrastructure");
    expect(categories).toContain("syntax-lint-error");
    expect(categories).toContain("unknown");

    // All counts should be zero
    for (const stat of response.body.stats) {
      expect(stat.helpful).toBe(0);
      expect(stat.unhelpful).toBe(0);
    }
  });

  it("should return correct counts when feedback exists", async () => {
    // Create build records with different categories
    const id1 = createBuildRecord();
    (db as unknown as DatabaseType)
      .prepare("UPDATE build_records SET category = ? WHERE id = ?")
      .run("test-failure", id1);

    const id2 = createBuildRecord();
    (db as unknown as DatabaseType)
      .prepare("UPDATE build_records SET category = ? WHERE id = ?")
      .run("test-failure", id2);

    const id3 = createBuildRecord();
    (db as unknown as DatabaseType)
      .prepare("UPDATE build_records SET category = ? WHERE id = ?")
      .run("docker-build-failure", id3);

    // Submit feedback
    const client1 = uuidv4();
    const client2 = uuidv4();
    const client3 = uuidv4();

    await request(app)
      .post(`/diagnoses/${id1}/feedback`)
      .set("X-Client-Id", client1)
      .send({ rating: "helpful" });

    await request(app)
      .post(`/diagnoses/${id2}/feedback`)
      .set("X-Client-Id", client2)
      .send({ rating: "unhelpful" });

    await request(app)
      .post(`/diagnoses/${id3}/feedback`)
      .set("X-Client-Id", client3)
      .send({ rating: "helpful" });

    // Get stats
    const response = await request(app)
      .get("/feedback/stats")
      .expect(200);

    expect(response.body.stats).toHaveLength(7);

    const testFailureStats = response.body.stats.find(
      (s: any) => s.category === "test-failure"
    );
    expect(testFailureStats).toMatchObject({
      category: "test-failure",
      helpful: 1,
      unhelpful: 1,
    });

    const dockerStats = response.body.stats.find(
      (s: any) => s.category === "docker-build-failure"
    );
    expect(dockerStats).toMatchObject({
      category: "docker-build-failure",
      helpful: 1,
      unhelpful: 0,
    });

    // Categories with no feedback should have zero counts
    const unknownStats = response.body.stats.find(
      (s: any) => s.category === "unknown"
    );
    expect(unknownStats).toMatchObject({
      category: "unknown",
      helpful: 0,
      unhelpful: 0,
    });
  });

  it("should handle multiple clients rating the same diagnosis", async () => {
    const buildRecordId = createBuildRecord();
    (db as unknown as DatabaseType)
      .prepare("UPDATE build_records SET category = ? WHERE id = ?")
      .run("test-failure", buildRecordId);

    const client1 = uuidv4();
    const client2 = uuidv4();
    const client3 = uuidv4();

    // Three different clients rate the same diagnosis
    await request(app)
      .post(`/diagnoses/${buildRecordId}/feedback`)
      .set("X-Client-Id", client1)
      .send({ rating: "helpful" });

    await request(app)
      .post(`/diagnoses/${buildRecordId}/feedback`)
      .set("X-Client-Id", client2)
      .send({ rating: "helpful" });

    await request(app)
      .post(`/diagnoses/${buildRecordId}/feedback`)
      .set("X-Client-Id", client3)
      .send({ rating: "unhelpful" });

    const response = await request(app)
      .get("/feedback/stats")
      .expect(200);

    const testFailureStats = response.body.stats.find(
      (s: any) => s.category === "test-failure"
    );
    expect(testFailureStats).toMatchObject({
      category: "test-failure",
      helpful: 2,
      unhelpful: 1,
    });
  });
});
