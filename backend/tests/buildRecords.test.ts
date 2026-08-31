/**
 * Unit tests for BuildRecord data-access functions.
 *
 * Requirements: 10.2, 10.3, 10.4, 10.6
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";

// Use a test-specific DATABASE_PATH before importing the module
const testDbPath = path.join(__dirname, ".test-build-records.db");
process.env.DATABASE_PATH = testDbPath;

// Clean up any existing test DB
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

// Now import after env is set
const {
  insertBuildRecord,
  getBuildRecordById,
  updateBuildRecord,
  listBuildRecords,
  BuildRecordValidationError,
} = await import("../src/db/buildRecords.js");

beforeAll(() => {
  // DB is initialized by the import
});

afterAll(() => {
  // Clean up test database file
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  const shmPath = testDbPath + "-shm";
  const walPath = testDbPath + "-wal";
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
});

// ── Insert Tests ──────────────────────────────────────────────────────────────

describe("insertBuildRecord", () => {
  it("should generate UUID v4 and set status to pending", () => {
    const record = insertBuildRecord({
      repoName: "acme/test-repo",
      jobName: "CI / build",
      commitSha: "a".repeat(40),
      source: "github",
      rawLog: "build failed",
    });

    expect(record.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(record.status).toBe("pending");
    expect(record.repoName).toBe("acme/test-repo");
    expect(record.jobName).toBe("CI / build");
    expect(record.commitSha).toBe("a".repeat(40));
    expect(record.source).toBe("github");
    expect(record.rawLog).toBe("build failed");
    expect(record.cleanedLog).toBeNull();
    expect(record.truncated).toBe(false);
    expect(record.category).toBeNull();
    expect(record.retryCount).toBe(0);
    expect(record.createdAt).toBeInstanceOf(Date);
    expect(record.completedAt).toBeNull();
  });

  it("should accept 40-character hex commitSha (SHA-1)", () => {
    const record = insertBuildRecord({
      repoName: "acme/test",
      jobName: "test",
      commitSha: "1234567890abcdef1234567890abcdef12345678",
      source: "github",
      rawLog: "log",
    });

    expect(record.commitSha).toBe("1234567890abcdef1234567890abcdef12345678");
  });

  it("should accept 64-character hex commitSha (SHA-256)", () => {
    const record = insertBuildRecord({
      repoName: "acme/test",
      jobName: "test",
      commitSha: "a".repeat(64),
      source: "github",
      rawLog: "log",
    });

    expect(record.commitSha).toBe("a".repeat(64));
  });

  it("should throw BuildRecordValidationError for invalid commitSha length", () => {
    expect(() =>
      insertBuildRecord({
        repoName: "acme/test",
        jobName: "test",
        commitSha: "abc123",
        source: "github",
        rawLog: "log",
      }),
    ).toThrow(BuildRecordValidationError);

    expect(() =>
      insertBuildRecord({
        repoName: "acme/test",
        jobName: "test",
        commitSha: "abc123",
        source: "github",
        rawLog: "log",
      }),
    ).toThrow(/commitSha must be a 40- or 64-character hexadecimal string/);
  });

  it("should throw BuildRecordValidationError for non-hex commitSha", () => {
    expect(() =>
      insertBuildRecord({
        repoName: "acme/test",
        jobName: "test",
        commitSha: "x".repeat(40),
        source: "github",
        rawLog: "log",
      }),
    ).toThrow(BuildRecordValidationError);
  });

  it("should accept all valid source values", () => {
    const github = insertBuildRecord({
      repoName: "test",
      jobName: "test",
      commitSha: "a".repeat(40),
      source: "github",
      rawLog: "log",
    });
    expect(github.source).toBe("github");

    const jenkins = insertBuildRecord({
      repoName: "test",
      jobName: "test",
      commitSha: "b".repeat(40),
      source: "jenkins",
      rawLog: "log",
    });
    expect(jenkins.source).toBe("jenkins");

    const simulate = insertBuildRecord({
      repoName: "test",
      jobName: "test",
      commitSha: "c".repeat(40),
      source: "simulate",
      rawLog: "log",
    });
    expect(simulate.source).toBe("simulate");
  });

  it("should throw BuildRecordValidationError for invalid source", () => {
    expect(() =>
      insertBuildRecord({
        repoName: "test",
        jobName: "test",
        commitSha: "a".repeat(40),
        // @ts-expect-error - testing invalid source
        source: "invalid",
        rawLog: "log",
      }),
    ).toThrow(BuildRecordValidationError);

    expect(() =>
      insertBuildRecord({
        repoName: "test",
        jobName: "test",
        commitSha: "a".repeat(40),
        // @ts-expect-error - testing invalid source
        source: "invalid",
        rawLog: "log",
      }),
    ).toThrow(/source must be one of "github", "jenkins", or "simulate"/);
  });

  it("should accept optional branch field", () => {
    const withBranch = insertBuildRecord({
      repoName: "test",
      jobName: "test",
      commitSha: "a".repeat(40),
      source: "github",
      rawLog: "log",
      branch: "feat/new-feature",
    });
    expect(withBranch.branch).toBe("feat/new-feature");

    const withoutBranch = insertBuildRecord({
      repoName: "test",
      jobName: "test",
      commitSha: "b".repeat(40),
      source: "github",
      rawLog: "log",
    });
    expect(withoutBranch.branch).toBeNull();
  });
});

// ── Get By ID Tests ───────────────────────────────────────────────────────────

describe("getBuildRecordById", () => {
  it("should return the record for an existing id", () => {
    const inserted = insertBuildRecord({
      repoName: "acme/test",
      jobName: "test",
      commitSha: "a".repeat(40),
      source: "github",
      rawLog: "log",
    });

    const fetched = getBuildRecordById(inserted.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(inserted.id);
    expect(fetched?.repoName).toBe("acme/test");
  });

  it("should return null for a non-existent id", () => {
    const result = getBuildRecordById("non-existent-uuid");
    expect(result).toBeNull();
  });
});

// ── Update Tests ──────────────────────────────────────────────────────────────

describe("updateBuildRecord", () => {
  it("should update status and other fields", () => {
    const record = insertBuildRecord({
      repoName: "test",
      jobName: "test",
      commitSha: "a".repeat(40),
      source: "github",
      rawLog: "log",
    });

    updateBuildRecord(record.id, {
      status: "complete",
      category: "test-failure",
      explanation: "Tests failed",
      suggestedFix: "Fix the test",
      confidence: "high",
      retryCount: 1,
    });

    const updated = getBuildRecordById(record.id);
    expect(updated?.status).toBe("complete");
    expect(updated?.category).toBe("test-failure");
    expect(updated?.explanation).toBe("Tests failed");
    expect(updated?.suggestedFix).toBe("Fix the test");
    expect(updated?.confidence).toBe("high");
    expect(updated?.retryCount).toBe(1);
  });

  it("should set completedAt when status transitions to complete", () => {
    const record = insertBuildRecord({
      repoName: "test",
      jobName: "test",
      commitSha: "a".repeat(40),
      source: "github",
      rawLog: "log",
    });

    expect(record.completedAt).toBeNull();

    updateBuildRecord(record.id, { status: "complete" });

    const updated = getBuildRecordById(record.id);
    expect(updated?.completedAt).not.toBeNull();
    expect(updated?.completedAt).toBeInstanceOf(Date);
  });

  it("should set completedAt when status transitions to unavailable", () => {
    const record = insertBuildRecord({
      repoName: "test",
      jobName: "test",
      commitSha: "a".repeat(40),
      source: "github",
      rawLog: "log",
    });

    expect(record.completedAt).toBeNull();

    updateBuildRecord(record.id, {
      status: "unavailable",
      errorMessage: "LLM error",
    });

    const updated = getBuildRecordById(record.id);
    expect(updated?.status).toBe("unavailable");
    expect(updated?.errorMessage).toBe("LLM error");
    expect(updated?.completedAt).not.toBeNull();
    expect(updated?.completedAt).toBeInstanceOf(Date);
  });

  it("should not set completedAt when status remains pending", () => {
    const record = insertBuildRecord({
      repoName: "test",
      jobName: "test",
      commitSha: "a".repeat(40),
      source: "github",
      rawLog: "log",
    });

    updateBuildRecord(record.id, { retryCount: 1 });

    const updated = getBuildRecordById(record.id);
    expect(updated?.completedAt).toBeNull();
    expect(updated?.retryCount).toBe(1);
  });

  it("should update cleanedLog and truncated fields", () => {
    const record = insertBuildRecord({
      repoName: "test",
      jobName: "test",
      commitSha: "a".repeat(40),
      source: "github",
      rawLog: "very long log",
    });

    updateBuildRecord(record.id, {
      cleanedLog: "cleaned log",
      truncated: true,
    });

    const updated = getBuildRecordById(record.id);
    expect(updated?.cleanedLog).toBe("cleaned log");
    expect(updated?.truncated).toBe(true);
  });

  it("should no-op when updating a non-existent record", () => {
    // Should not throw
    updateBuildRecord("non-existent-id", { status: "complete" });
  });

  it("should handle null values for nullable fields", () => {
    const record = insertBuildRecord({
      repoName: "test",
      jobName: "test",
      commitSha: "a".repeat(40),
      source: "github",
      rawLog: "log",
    });

    // First set some values
    updateBuildRecord(record.id, {
      category: "test-failure",
      explanation: "Some explanation",
    });

    // Then set them to null
    updateBuildRecord(record.id, {
      category: null,
      explanation: null,
    });

    const updated = getBuildRecordById(record.id);
    expect(updated?.category).toBeNull();
    expect(updated?.explanation).toBeNull();
  });
});

// ── List Tests ────────────────────────────────────────────────────────────────

describe("listBuildRecords", () => {
  it("should return paginated results with default values", () => {
    // Insert multiple records with different categories and timestamps
    for (let i = 0; i < 5; i++) {
      const record = insertBuildRecord({
        repoName: `repo-${i}`,
        jobName: "test",
        commitSha: i.toString().padStart(40, "0"),
        source: "github",
        rawLog: "log",
      });

      // Update some to have categories
      if (i % 2 === 0) {
        updateBuildRecord(record.id, {
          status: "complete",
          category: "test-failure",
        });
      } else {
        updateBuildRecord(record.id, {
          status: "complete",
          category: "dependency-build-error",
        });
      }
    }

    const result = listBuildRecords();
    expect(result.data.length).toBeGreaterThanOrEqual(5);
    expect(result.total).toBeGreaterThanOrEqual(5);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("should respect custom page and limit", () => {
    const result = listBuildRecords({ page: 1, limit: 2 });
    expect(result.pageSize).toBe(2);
    expect(result.page).toBe(1);
  });

  it("should cap limit at 100", () => {
    const result = listBuildRecords({ limit: 200 });
    expect(result.pageSize).toBe(100);
  });

  it("should filter by category", () => {
    const result = listBuildRecords({ category: "test-failure" });
    expect(result.data.every((r) => r.category === "test-failure")).toBe(true);
  });

  it("should return empty data array for page beyond total", () => {
    const result = listBuildRecords({ page: 1000 });
    expect(result.data).toHaveLength(0);
    expect(result.page).toBe(1000);
  });

  it("should sort by created_at DESC", () => {
    const result = listBuildRecords({ limit: 10 });
    
    // Check that records are in descending order by creation time
    for (let i = 0; i < result.data.length - 1; i++) {
      const current = new Date(result.data[i].createdAt).getTime();
      const next = new Date(result.data[i + 1].createdAt).getTime();
      expect(current).toBeGreaterThanOrEqual(next);
    }
  });

  it("should handle empty result set with category filter", () => {
    const result = listBuildRecords({ category: "unknown" });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});
