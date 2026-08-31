/**
 * Unit tests for feedback data-access functions.
 *
 * Tests the upsertFeedback and getFeedbackStats functions, including:
 * - Initial feedback creation
 * - Feedback replacement (upsert behavior)
 * - Stats aggregation across all seven categories
 * - Zero defaults for categories with no ratings
 * - Validation of invalid ratings
 */

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db/init.js";
import {
  upsertFeedback,
  getFeedbackStats,
  FeedbackValidationError,
} from "../src/db/feedback.js";
import { insertBuildRecord } from "../src/db/buildRecords.js";
import type { FailureCategory } from "../src/types.js";

describe("Feedback data-access", () => {
  beforeEach(() => {
    // Clean slate for each test
    db.exec("DELETE FROM feedback");
    db.exec("DELETE FROM build_records");
  });

  describe("upsertFeedback", () => {
    it("creates a new feedback record with valid inputs", () => {
      const record = insertBuildRecord({
        repoName: "test/repo",
        jobName: "test-job",
        commitSha: "a".repeat(40),
        source: "github",
        rawLog: "test log",
      });

      const feedback = upsertFeedback(record.id, "client-123", "helpful");

      expect(feedback.buildRecordId).toBe(record.id);
      expect(feedback.clientId).toBe("client-123");
      expect(feedback.rating).toBe("helpful");
      expect(feedback.createdAt).toBeInstanceOf(Date);
    });

    it("replaces an existing rating for the same client and diagnosis", () => {
      const record = insertBuildRecord({
        repoName: "test/repo",
        jobName: "test-job",
        commitSha: "a".repeat(40),
        source: "github",
        rawLog: "test log",
      });

      const firstFeedback = upsertFeedback(
        record.id,
        "client-456",
        "unhelpful",
      );
      const secondFeedback = upsertFeedback(record.id, "client-456", "helpful");

      expect(secondFeedback.rating).toBe("helpful");
      expect(secondFeedback.buildRecordId).toBe(record.id);
      expect(secondFeedback.clientId).toBe("client-456");

      // Verify only one record exists
      const count = db
        .prepare(
          "SELECT COUNT(*) as count FROM feedback WHERE build_record_id = ? AND client_id = ?",
        )
        .get(record.id, "client-456") as { count: number };
      expect(count.count).toBe(1);
    });

    it("allows different clients to rate the same diagnosis", () => {
      const record = insertBuildRecord({
        repoName: "test/repo",
        jobName: "test-job",
        commitSha: "a".repeat(40),
        source: "github",
        rawLog: "test log",
      });

      upsertFeedback(record.id, "client-a", "helpful");
      upsertFeedback(record.id, "client-b", "unhelpful");

      const count = db
        .prepare(
          "SELECT COUNT(*) as count FROM feedback WHERE build_record_id = ?",
        )
        .get(record.id) as { count: number };
      expect(count.count).toBe(2);
    });

    it("throws FeedbackValidationError for invalid rating", () => {
      const record = insertBuildRecord({
        repoName: "test/repo",
        jobName: "test-job",
        commitSha: "a".repeat(40),
        source: "github",
        rawLog: "test log",
      });

      expect(() => {
        upsertFeedback(record.id, "client-123", "invalid" as never);
      }).toThrow(FeedbackValidationError);
    });
  });

  describe("getFeedbackStats", () => {
    it("returns all seven categories with zero counts when no feedback exists", () => {
      const stats = getFeedbackStats();

      expect(stats).toHaveLength(7);

      const categories = stats.map((s) => s.category);
      expect(categories).toContain("dependency-build-error");
      expect(categories).toContain("test-failure");
      expect(categories).toContain("docker-build-failure");
      expect(categories).toContain("env-var-secrets");
      expect(categories).toContain("timeout-infrastructure");
      expect(categories).toContain("syntax-lint-error");
      expect(categories).toContain("unknown");

      for (const stat of stats) {
        expect(stat.helpful).toBe(0);
        expect(stat.unhelpful).toBe(0);
      }
    });

    it("aggregates feedback counts correctly for categories with ratings", () => {
      // Create records with different categories
      const record1 = insertBuildRecord({
        repoName: "test/repo",
        jobName: "test-job",
        commitSha: "a".repeat(40),
        source: "github",
        rawLog: "test log",
      });
      db.prepare("UPDATE build_records SET category = ? WHERE id = ?").run(
        "test-failure",
        record1.id,
      );

      const record2 = insertBuildRecord({
        repoName: "test/repo",
        jobName: "test-job",
        commitSha: "b".repeat(40),
        source: "github",
        rawLog: "test log",
      });
      db.prepare("UPDATE build_records SET category = ? WHERE id = ?").run(
        "docker-build-failure",
        record2.id,
      );

      // Add feedback
      upsertFeedback(record1.id, "client-1", "helpful");
      upsertFeedback(record1.id, "client-2", "helpful");
      upsertFeedback(record1.id, "client-3", "unhelpful");
      upsertFeedback(record2.id, "client-4", "unhelpful");

      const stats = getFeedbackStats();

      const testFailureStats = stats.find(
        (s) => s.category === "test-failure",
      );
      expect(testFailureStats).toEqual({
        category: "test-failure",
        helpful: 2,
        unhelpful: 1,
      });

      const dockerStats = stats.find(
        (s) => s.category === "docker-build-failure",
      );
      expect(dockerStats).toEqual({
        category: "docker-build-failure",
        helpful: 0,
        unhelpful: 1,
      });

      // Other categories should have zero counts
      const unknownStats = stats.find((s) => s.category === "unknown");
      expect(unknownStats).toEqual({
        category: "unknown",
        helpful: 0,
        unhelpful: 0,
      });
    });

    it("returns zero counts for categories with no feedback", () => {
      const record = insertBuildRecord({
        repoName: "test/repo",
        jobName: "test-job",
        commitSha: "a".repeat(40),
        source: "github",
        rawLog: "test log",
      });
      db.prepare("UPDATE build_records SET category = ? WHERE id = ?").run(
        "test-failure",
        record.id,
      );

      upsertFeedback(record.id, "client-1", "helpful");

      const stats = getFeedbackStats();

      // test-failure should have counts
      const testFailureStats = stats.find(
        (s) => s.category === "test-failure",
      );
      expect(testFailureStats?.helpful).toBe(1);

      // All other categories should have zero counts
      const otherCategories = stats.filter(
        (s) => s.category !== "test-failure",
      );
      expect(otherCategories).toHaveLength(6);
      for (const stat of otherCategories) {
        expect(stat.helpful).toBe(0);
        expect(stat.unhelpful).toBe(0);
      }
    });

    it("handles multiple ratings for the same category from different diagnoses", () => {
      // Create two records with the same category
      const record1 = insertBuildRecord({
        repoName: "test/repo",
        jobName: "test-job",
        commitSha: "a".repeat(40),
        source: "github",
        rawLog: "test log",
      });
      db.prepare("UPDATE build_records SET category = ? WHERE id = ?").run(
        "test-failure",
        record1.id,
      );

      const record2 = insertBuildRecord({
        repoName: "test/repo",
        jobName: "test-job",
        commitSha: "b".repeat(40),
        source: "github",
        rawLog: "test log",
      });
      db.prepare("UPDATE build_records SET category = ? WHERE id = ?").run(
        "test-failure",
        record2.id,
      );

      upsertFeedback(record1.id, "client-1", "helpful");
      upsertFeedback(record2.id, "client-2", "unhelpful");

      const stats = getFeedbackStats();
      const testFailureStats = stats.find(
        (s) => s.category === "test-failure",
      );

      expect(testFailureStats).toEqual({
        category: "test-failure",
        helpful: 1,
        unhelpful: 1,
      });
    });
  });
});
