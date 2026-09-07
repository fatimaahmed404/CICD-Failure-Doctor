/**
 * Unit tests for ingestBuild (backend/src/services/ingestBuild.ts)
 *
 * Strategy:
 *   - Mock `db/buildRecords` so no real SQLite database is needed.
 *   - Mock `jobQueue` so no real p-queue is started.
 *   - Test the five core scenarios described in task 9.4.
 *
 * Requirements: 1.1, 1.3, 10.2, 10.3
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BuildRecord } from "../src/types.js";

// ── Shared mock state ─────────────────────────────────────────────────────────

const mockInsertBuildRecord = vi.fn<
  Parameters<typeof import("../src/db/buildRecords.js").insertBuildRecord>,
  ReturnType<typeof import("../src/db/buildRecords.js").insertBuildRecord>
>();

const mockEnqueue = vi.fn<
  Parameters<typeof import("../src/jobQueue.js").enqueue>,
  ReturnType<typeof import("../src/jobQueue.js").enqueue>
>();

vi.mock("../src/db/buildRecords.js", () => ({
  insertBuildRecord: mockInsertBuildRecord,
}));

vi.mock("../src/jobQueue.js", () => ({
  enqueue: mockEnqueue,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_COMMIT_SHA = "a".repeat(40);

const VALID_PAYLOAD = {
  log: "Step 1/3: FROM node:18\nError: something went wrong",
  repoName: "demo/repo",
  jobName: "CI / test",
  commitSha: VALID_COMMIT_SHA,
  branch: "main",
};

const INSERTED_RECORD: BuildRecord = {
  id: "00000000-0000-0000-0000-000000000001",
  repoName: VALID_PAYLOAD.repoName,
  jobName: VALID_PAYLOAD.jobName,
  commitSha: VALID_COMMIT_SHA,
  branch: "main",
  source: "github",
  rawLog: VALID_PAYLOAD.log,
  cleanedLog: null,
  truncated: false,
  status: "pending",
  category: null,
  explanation: null,
  suggestedFix: null,
  confidence: null,
  retryCount: 0,
  errorMessage: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  completedAt: null,
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockInsertBuildRecord.mockReset();
  mockEnqueue.mockReset();

  // Default happy-path stub — individual tests override as needed.
  mockInsertBuildRecord.mockReturnValue({ ...INSERTED_RECORD });
  mockEnqueue.mockReturnValue(undefined);
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function importIngestBuild() {
  const mod = await import("../src/services/ingestBuild.js");
  return {
    ingestBuild: mod.ingestBuild,
    IngestValidationError: mod.IngestValidationError,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ingestBuild", () => {
  // ── 1. Happy path ────────────────────────────────────────────────────────────

  describe("happy path", () => {
    it(
      "returns the inserted BuildRecord with status=pending and enqueues the job " +
        "(Req 1.1, 10.2, 10.3)",
      async () => {
        const { ingestBuild } = await importIngestBuild();

        const result = await ingestBuild(VALID_PAYLOAD, "github");

        // The returned record is the one coming back from insertBuildRecord.
        expect(result).toEqual(INSERTED_RECORD);
        expect(result.status).toBe("pending");

        // insertBuildRecord must have been called with the correct shape.
        expect(mockInsertBuildRecord).toHaveBeenCalledOnce();
        expect(mockInsertBuildRecord).toHaveBeenCalledWith({
          repoName: VALID_PAYLOAD.repoName,
          jobName: VALID_PAYLOAD.jobName,
          commitSha: VALID_PAYLOAD.commitSha,
          source: "github",
          rawLog: VALID_PAYLOAD.log,
          branch: "main",
          userId: null,
        });

        // The job must be enqueued with the newly created record's id.
        expect(mockEnqueue).toHaveBeenCalledOnce();
        expect(mockEnqueue).toHaveBeenCalledWith({
          buildRecordId: INSERTED_RECORD.id,
        });
      },
    );

    it("works with a 64-character SHA-256 commitSha (Req 10.3)", async () => {
      const { ingestBuild } = await importIngestBuild();

      const payload64 = { ...VALID_PAYLOAD, commitSha: "b".repeat(64) };
      mockInsertBuildRecord.mockReturnValueOnce({
        ...INSERTED_RECORD,
        commitSha: "b".repeat(64),
      });

      const result = await ingestBuild(payload64, "github");

      expect(result.commitSha).toBe("b".repeat(64));
      expect(mockInsertBuildRecord).toHaveBeenCalledOnce();
      expect(mockEnqueue).toHaveBeenCalledOnce();
    });

    it('accepts source="jenkins" (Req 1.1)', async () => {
      const { ingestBuild } = await importIngestBuild();

      mockInsertBuildRecord.mockReturnValueOnce({
        ...INSERTED_RECORD,
        source: "jenkins",
      });

      const result = await ingestBuild(VALID_PAYLOAD, "jenkins");

      expect(result.source).toBe("jenkins");
      expect(mockInsertBuildRecord).toHaveBeenCalledOnce();
    });

    it('accepts source="simulate" (Req 1.1)', async () => {
      const { ingestBuild } = await importIngestBuild();

      mockInsertBuildRecord.mockReturnValueOnce({
        ...INSERTED_RECORD,
        source: "simulate",
      });

      const result = await ingestBuild(VALID_PAYLOAD, "simulate");

      expect(result.source).toBe("simulate");
      expect(mockInsertBuildRecord).toHaveBeenCalledOnce();
    });

    it("treats absent branch as null (Req 1.1)", async () => {
      const { ingestBuild } = await importIngestBuild();

      const payloadNoBranch = { ...VALID_PAYLOAD };
      delete (payloadNoBranch as Record<string, unknown>)["branch"];

      await ingestBuild(payloadNoBranch, "github");

      expect(mockInsertBuildRecord).toHaveBeenCalledWith(
        expect.objectContaining({ branch: null }),
      );
    });
  });

  // ── 2. Missing required field ─────────────────────────────────────────────

  describe("missing required field", () => {
    it(
      'throws IngestValidationError listing "log" when log is absent (Req 1.3)',
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        const payload = { ...VALID_PAYLOAD, log: undefined as unknown as string };

        await expect(ingestBuild(payload, "github")).rejects.toBeInstanceOf(
          IngestValidationError,
        );

        try {
          await ingestBuild(payload, "github");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
          if (err instanceof IngestValidationError) {
            expect(err.details.some((d) => /log/i.test(d))).toBe(true);
          }
        }

        // Nothing should have been persisted or enqueued.
        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );

    it(
      'throws IngestValidationError listing "repoName" when repoName is absent (Req 1.3)',
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        const payload = {
          ...VALID_PAYLOAD,
          repoName: undefined as unknown as string,
        };

        try {
          await ingestBuild(payload, "github");
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
          if (err instanceof IngestValidationError) {
            expect(err.details.some((d) => /repoName/i.test(d))).toBe(true);
          }
        }

        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );

    it(
      "collects all offending fields into details in one throw (Req 1.3)",
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        const payload = {
          log: undefined as unknown as string,
          repoName: undefined as unknown as string,
          jobName: undefined as unknown as string,
          commitSha: undefined as unknown as string,
        };

        try {
          await ingestBuild(payload, "github");
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
          if (err instanceof IngestValidationError) {
            // All four missing fields should appear in the details array.
            expect(err.details.length).toBeGreaterThanOrEqual(4);
          }
        }
      },
    );
  });

  // ── 3. Whitespace-only field ──────────────────────────────────────────────

  describe("whitespace-only field", () => {
    it(
      'throws IngestValidationError when repoName is "   " (Req 1.3)',
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        const payload = { ...VALID_PAYLOAD, repoName: "   " };

        try {
          await ingestBuild(payload, "github");
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
          if (err instanceof IngestValidationError) {
            expect(err.details.some((d) => /repoName/i.test(d))).toBe(true);
          }
        }

        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );

    it(
      'throws IngestValidationError when log is "\\n\\t\\n" (Req 1.3)',
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        const payload = { ...VALID_PAYLOAD, log: "\n\t\n" };

        try {
          await ingestBuild(payload, "github");
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
          if (err instanceof IngestValidationError) {
            expect(err.details.some((d) => /log/i.test(d))).toBe(true);
          }
        }

        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );

    it(
      'throws IngestValidationError when jobName is a single space " " (Req 1.3)',
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        const payload = { ...VALID_PAYLOAD, jobName: " " };

        try {
          await ingestBuild(payload, "github");
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
          if (err instanceof IngestValidationError) {
            expect(err.details.some((d) => /jobName/i.test(d))).toBe(true);
          }
        }

        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );
  });

  // ── 4. Invalid commitSha format ───────────────────────────────────────────

  describe("invalid commitSha format", () => {
    it(
      "throws IngestValidationError for a commitSha that is too short (Req 10.3)",
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        const payload = { ...VALID_PAYLOAD, commitSha: "abc123" };

        try {
          await ingestBuild(payload, "github");
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
          if (err instanceof IngestValidationError) {
            expect(err.details.some((d) => /commitSha/i.test(d))).toBe(true);
          }
        }

        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );

    it(
      "throws IngestValidationError for a commitSha with non-hex characters (Req 10.3)",
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        // 40 chars but contains 'g' which is not hex.
        const payload = {
          ...VALID_PAYLOAD,
          commitSha: "g".repeat(40),
        };

        try {
          await ingestBuild(payload, "github");
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
          if (err instanceof IngestValidationError) {
            expect(err.details.some((d) => /commitSha/i.test(d))).toBe(true);
          }
        }

        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );

    it(
      "throws IngestValidationError for a commitSha that is exactly 41 hex chars (Req 10.3)",
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        const payload = { ...VALID_PAYLOAD, commitSha: "a".repeat(41) };

        try {
          await ingestBuild(payload, "github");
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
        }

        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );

    it(
      "throws IngestValidationError for an empty commitSha string (Req 1.3, 10.3)",
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        const payload = { ...VALID_PAYLOAD, commitSha: "" };

        try {
          await ingestBuild(payload, "github");
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
          if (err instanceof IngestValidationError) {
            expect(err.details.some((d) => /commitSha/i.test(d))).toBe(true);
          }
        }

        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );
  });

  // ── 5. Invalid source value ───────────────────────────────────────────────

  describe("invalid source value", () => {
    it(
      'throws IngestValidationError for source="gitlab" (Req 10.4)',
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        try {
          // Cast to bypass TypeScript type guard — we're testing runtime validation.
          await ingestBuild(VALID_PAYLOAD, "gitlab" as never);
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
          if (err instanceof IngestValidationError) {
            expect(err.details.some((d) => /source/i.test(d))).toBe(true);
          }
        }

        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );

    it(
      'throws IngestValidationError for source="GitHub" (case-sensitive check, Req 10.4)',
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        try {
          await ingestBuild(VALID_PAYLOAD, "GitHub" as never);
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
        }

        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );

    it(
      'throws IngestValidationError for source="" (empty string, Req 10.4)',
      async () => {
        const { ingestBuild, IngestValidationError } =
          await importIngestBuild();

        try {
          await ingestBuild(VALID_PAYLOAD, "" as never);
          expect.fail("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(IngestValidationError);
          if (err instanceof IngestValidationError) {
            expect(err.details.some((d) => /source/i.test(d))).toBe(true);
          }
        }

        expect(mockInsertBuildRecord).not.toHaveBeenCalled();
        expect(mockEnqueue).not.toHaveBeenCalled();
      },
    );
  });
});
