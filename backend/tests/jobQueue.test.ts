/**
 * Unit tests for processJob (backend/src/jobQueue.ts)
 *
 * Strategy:
 *   - Mock all I/O dependencies: db/buildRecords, llmClient, logProcessor,
 *     and services/notificationService.
 *   - Mock p-queue so that queue.add() runs the callback synchronously,
 *     letting us test processJob in isolation without concurrency overhead.
 *   - Test processJob directly for the six core scenarios.
 *   - Test the 120-second SLA watchdog via enqueue() + vi.useFakeTimers().
 *
 * Requirements: 3.1, 3.2, 3.3, 3.5, 6.1, 6.2, 6.4
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import type { BuildRecord, DiagnosisResult } from "../src/types.js";

// ── Shared mock state ─────────────────────────────────────────────────────────
//
// We declare mocks at module scope so vi.mock factories can capture them.
// All mocks are reset in beforeEach.

const mockGetBuildRecordById = vi.fn<
  Parameters<typeof import("../src/db/buildRecords.js").getBuildRecordById>,
  ReturnType<typeof import("../src/db/buildRecords.js").getBuildRecordById>
>();
const mockUpdateBuildRecord = vi.fn<
  Parameters<typeof import("../src/db/buildRecords.js").updateBuildRecord>,
  ReturnType<typeof import("../src/db/buildRecords.js").updateBuildRecord>
>();
const mockTruncateLog = vi.fn<
  Parameters<typeof import("../src/logProcessor.js").truncateLog>,
  ReturnType<typeof import("../src/logProcessor.js").truncateLog>
>();
const mockDiagnoseBuild = vi.fn<
  Parameters<typeof import("../src/llmClient.js").diagnoseBuild>,
  ReturnType<typeof import("../src/llmClient.js").diagnoseBuild>
>();
const mockNotify = vi.fn<
  Parameters<typeof import("../src/services/notificationService.js").notify>,
  ReturnType<typeof import("../src/services/notificationService.js").notify>
>();

// p-queue mock: queue.add(fn) calls fn() immediately and returns its result.
const mockQueueAdd = vi.fn(async (fn: () => Promise<void>) => {
  await fn();
});

vi.mock("../src/db/buildRecords.js", () => ({
  getBuildRecordById: mockGetBuildRecordById,
  updateBuildRecord: mockUpdateBuildRecord,
}));

vi.mock("../src/logProcessor.js", () => ({
  truncateLog: mockTruncateLog,
}));

vi.mock("../src/llmClient.js", async (importOriginal) => {
  // Keep the real error classes so instanceof checks in processJob work.
  const original =
    await importOriginal<typeof import("../src/llmClient.js")>();
  return {
    ...original,
    diagnoseBuild: mockDiagnoseBuild,
  };
});

vi.mock("../src/services/notificationService.js", () => ({
  notify: mockNotify,
}));

vi.mock("p-queue", () => {
  return {
    default: class MockPQueue {
      add = mockQueueAdd;
    },
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_RECORD: BuildRecord = {
  id: "00000000-0000-0000-0000-000000000001",
  repoName: "demo/repo",
  jobName: "CI / test",
  commitSha: "a".repeat(40),
  branch: "main",
  source: "github",
  rawLog: "some raw log content",
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

const TRUNCATE_RESULT = {
  cleanedLog: "cleaned log content",
  originalLineCount: 10,
  truncated: false,
};

const DIAGNOSIS_RESULT: DiagnosisResult = {
  category: "test-failure",
  explanation: "Unit tests failed due to assertion errors.",
  suggestedFix: "Fix the failing assertions in `src/utils.test.ts`.",
  confidence: "high",
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules();
  mockGetBuildRecordById.mockReset();
  mockUpdateBuildRecord.mockReset();
  mockTruncateLog.mockReset();
  mockDiagnoseBuild.mockReset();
  mockNotify.mockReset();
  mockQueueAdd.mockReset();

  // Restore default synchronous queue.add behaviour after each reset.
  mockQueueAdd.mockImplementation(async (fn: () => Promise<void>) => {
    await fn();
  });

  // Default happy-path stubs (individual tests override as needed).
  mockGetBuildRecordById.mockReturnValue({ ...BASE_RECORD });
  mockTruncateLog.mockReturnValue({ ...TRUNCATE_RESULT });
  mockNotify.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Import processJob fresh (after vi.resetModules in beforeEach). */
async function importProcessJob() {
  const mod = await import("../src/jobQueue.js");
  return { processJob: mod.processJob, enqueue: mod.enqueue };
}

/** Convenience: import the real error classes for constructing test errors. */
async function importErrors() {
  const mod = await import("../src/llmClient.js");
  return { LLMParseError: mod.LLMParseError, NetworkError: mod.NetworkError };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("processJob", () => {
  // ── 1. Success on first attempt ─────────────────────────────────────────────

  describe("success on first attempt", () => {
    it(
      "sets status=complete with all DiagnosisResult fields, completedAt, and retryCount=0 " +
        "(Req 3.1, 3.2, 6.4)",
      async () => {
        mockDiagnoseBuild.mockResolvedValueOnce({ ...DIAGNOSIS_RESULT });

        // After completing the job, getBuildRecordById is called again for the
        // notification payload — return a completed-looking record for it.
        mockGetBuildRecordById
          .mockReturnValueOnce({ ...BASE_RECORD })          // initial fetch
          .mockReturnValueOnce({ ...BASE_RECORD, status: "complete" }); // notification re-fetch

        const { processJob } = await importProcessJob();
        await processJob({ buildRecordId: BASE_RECORD.id });

        // Log truncation should have been persisted first.
        expect(mockUpdateBuildRecord).toHaveBeenCalledWith(BASE_RECORD.id, {
          cleanedLog: TRUNCATE_RESULT.cleanedLog,
          truncated: TRUNCATE_RESULT.truncated,
        });

        // Final status update should carry all DiagnosisResult fields.
        expect(mockUpdateBuildRecord).toHaveBeenCalledWith(BASE_RECORD.id, {
          status: "complete",
          category: DIAGNOSIS_RESULT.category,
          explanation: DIAGNOSIS_RESULT.explanation,
          suggestedFix: DIAGNOSIS_RESULT.suggestedFix,
          confidence: DIAGNOSIS_RESULT.confidence,
          retryCount: 0,
        });

        // diagnoseBuild called exactly once.
        expect(mockDiagnoseBuild).toHaveBeenCalledTimes(1);
      },
    );

    it("fires a fire-and-forget notification after status=complete (Req 3.2, 6.4)", async () => {
      mockDiagnoseBuild.mockResolvedValueOnce({ ...DIAGNOSIS_RESULT });
      mockGetBuildRecordById
        .mockReturnValueOnce({ ...BASE_RECORD })
        .mockReturnValueOnce({ ...BASE_RECORD, status: "complete" });

      const { processJob } = await importProcessJob();
      await processJob({ buildRecordId: BASE_RECORD.id });

      // Allow any microtasks from the fire-and-forget IIFE to flush.
      await vi.runAllTimersAsync().catch(() => {});
      await new Promise((r) => setTimeout(r, 0));

      expect(mockNotify).toHaveBeenCalledTimes(1);
    });

    it("does not affect BuildRecord status when notification fails (Req 12.3)", async () => {
      // Mock notify() to reject with an error
      mockNotify.mockRejectedValueOnce(new Error("Slack webhook failed"));
      
      mockDiagnoseBuild.mockResolvedValueOnce({ ...DIAGNOSIS_RESULT });
      mockGetBuildRecordById
        .mockReturnValueOnce({ ...BASE_RECORD })
        .mockReturnValueOnce({ ...BASE_RECORD, status: "complete" });

      const { processJob } = await importProcessJob();
      await processJob({ buildRecordId: BASE_RECORD.id });

      // Allow any microtasks from the fire-and-forget IIFE to flush.
      await vi.runAllTimersAsync().catch(() => {});
      await new Promise((r) => setTimeout(r, 0));

      // The record should still be marked as complete
      expect(mockUpdateBuildRecord).toHaveBeenCalledWith(BASE_RECORD.id, {
        status: "complete",
        category: DIAGNOSIS_RESULT.category,
        explanation: DIAGNOSIS_RESULT.explanation,
        suggestedFix: DIAGNOSIS_RESULT.suggestedFix,
        confidence: DIAGNOSIS_RESULT.confidence,
        retryCount: 0,
      });

      // notify() should have been called (and failed)
      expect(mockNotify).toHaveBeenCalledTimes(1);

      // The record should NOT have been updated to unavailable
      const unavailableCalls = mockUpdateBuildRecord.mock.calls.filter(
        ([, input]) => input.status === "unavailable"
      );
      expect(unavailableCalls).toHaveLength(0);
    });
  });

  // ── 2. Success on retry ─────────────────────────────────────────────────────

  describe("success on retry after NetworkError on first attempt", () => {
    it(
      "retries once, sets status=complete with retryCount=1 " +
        "(Req 3.1, 6.1, 6.4)",
      async () => {
        const { NetworkError } = await importErrors();

        mockDiagnoseBuild
          .mockRejectedValueOnce(new NetworkError("transient connection error"))
          .mockResolvedValueOnce({ ...DIAGNOSIS_RESULT });

        mockGetBuildRecordById
          .mockReturnValueOnce({ ...BASE_RECORD })
          .mockReturnValueOnce({ ...BASE_RECORD, status: "complete" });

        const { processJob } = await importProcessJob();
        await processJob({ buildRecordId: BASE_RECORD.id });

        expect(mockDiagnoseBuild).toHaveBeenCalledTimes(2);

        expect(mockUpdateBuildRecord).toHaveBeenCalledWith(BASE_RECORD.id, {
          status: "complete",
          category: DIAGNOSIS_RESULT.category,
          explanation: DIAGNOSIS_RESULT.explanation,
          suggestedFix: DIAGNOSIS_RESULT.suggestedFix,
          confidence: DIAGNOSIS_RESULT.confidence,
          retryCount: 1,   // one NetworkError was encountered before success
        });
      },
    );
  });

  // ── 3. Failure after both attempts (NetworkError twice) ─────────────────────

  describe("failure after both NetworkError attempts exhausted", () => {
    it(
      "sets status=unavailable with errorMessage and retryCount=1 " +
        "(Req 3.3, 6.1, 6.4)",
      async () => {
        const { NetworkError } = await importErrors();
        const error1 = new NetworkError("attempt 1 failed");
        const error2 = new NetworkError("attempt 2 failed");

        mockDiagnoseBuild
          .mockRejectedValueOnce(error1)
          .mockRejectedValueOnce(error2);

        const { processJob } = await importProcessJob();
        await processJob({ buildRecordId: BASE_RECORD.id });

        expect(mockDiagnoseBuild).toHaveBeenCalledTimes(2);

        expect(mockUpdateBuildRecord).toHaveBeenCalledWith(BASE_RECORD.id, {
          status: "unavailable",
          retryCount: 1,
          errorMessage: error2.message,
        });

        // notification must NOT have been sent on unavailable status
        expect(mockNotify).not.toHaveBeenCalled();
      },
    );

    it(
      "does not call notify() when the record ends as unavailable " +
        "(Req 6.3)",
      async () => {
        const { NetworkError } = await importErrors();
        mockDiagnoseBuild
          .mockRejectedValueOnce(new NetworkError("e1"))
          .mockRejectedValueOnce(new NetworkError("e2"));

        const { processJob } = await importProcessJob();
        await processJob({ buildRecordId: BASE_RECORD.id });

        await new Promise((r) => setTimeout(r, 0));
        expect(mockNotify).not.toHaveBeenCalled();
      },
    );
  });

  // ── 4. LLMParseError — unavailable immediately, no retry ────────────────────

  describe("LLMParseError", () => {
    it(
      "sets status=unavailable immediately without retrying, retryCount=0 " +
        "(Req 6.2, 6.4)",
      async () => {
        const { LLMParseError } = await importErrors();
        const parseErr = new LLMParseError("response is not valid JSON", "{{");

        mockDiagnoseBuild.mockRejectedValueOnce(parseErr);

        const { processJob } = await importProcessJob();
        await processJob({ buildRecordId: BASE_RECORD.id });

        // diagnoseBuild must have been called exactly once (no retry).
        expect(mockDiagnoseBuild).toHaveBeenCalledTimes(1);

        expect(mockUpdateBuildRecord).toHaveBeenCalledWith(BASE_RECORD.id, {
          status: "unavailable",
          retryCount: 0,
          errorMessage: parseErr.message,
        });
      },
    );

    it("does not call notify() after LLMParseError (Req 6.3)", async () => {
      const { LLMParseError } = await importErrors();
      mockDiagnoseBuild.mockRejectedValueOnce(
        new LLMParseError("bad json", "raw"),
      );

      const { processJob } = await importProcessJob();
      await processJob({ buildRecordId: BASE_RECORD.id });

      await new Promise((r) => setTimeout(r, 0));
      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  // ── 5. Missing build record — no-op ─────────────────────────────────────────

  describe("missing build record", () => {
    it(
      "returns without calling updateBuildRecord when the record is not found " +
        "(Req 3.1)",
      async () => {
        mockGetBuildRecordById.mockReturnValueOnce(null);

        const { processJob } = await importProcessJob();
        await processJob({ buildRecordId: "nonexistent-id" });

        expect(mockTruncateLog).not.toHaveBeenCalled();
        expect(mockDiagnoseBuild).not.toHaveBeenCalled();
        expect(mockUpdateBuildRecord).not.toHaveBeenCalled();
        expect(mockNotify).not.toHaveBeenCalled();
      },
    );
  });
});

// ── 6. SLA timeout via enqueue() ─────────────────────────────────────────────

describe("SLA timeout via enqueue()", () => {
  it(
    "forces status=unavailable with the canonical timeout message when the job " +
      "exceeds 120 seconds (Req 3.5)",
    async () => {
      vi.useFakeTimers();

      // diagnoseBuild never resolves (simulates a hung LLM call).
      mockDiagnoseBuild.mockReturnValue(new Promise<DiagnosisResult>(() => {}));

      // queue.add() must NOT immediately invoke the callback — we need
      // the SLA race to play out inside processJobWithSLA.  Override the
      // mock so it behaves like a real PQueue (runs the fn and awaits it).
      mockQueueAdd.mockImplementation(async (fn: () => Promise<void>) => {
        fn().catch(() => {}); // fire-and-forget so we can advance timers
      });

      const { enqueue } = await importProcessJob();

      // Enqueue the job (starts the SLA race internally).
      enqueue({ buildRecordId: BASE_RECORD.id });

      // Flush any synchronous microtasks queued during enqueue().
      await Promise.resolve();

      // Advance time past the 120-second SLA boundary, which also drains
      // any microtasks scheduled inside advanceTimersByTimeAsync.
      await vi.advanceTimersByTimeAsync(121_000);

      // One final microtask flush to let the catch branch in processJobWithSLA
      // call updateBuildRecord after the SLATimeoutError propagates.
      await Promise.resolve();
      await Promise.resolve();

      // The SLA timeout branch should have called updateBuildRecord with
      // the canonical error message.
      const unavailableCalls = (
        mockUpdateBuildRecord as Mock
      ).mock.calls.filter(
        ([, input]) =>
          input.status === "unavailable" &&
          input.errorMessage === "Diagnosis SLA timeout: exceeded 120 s",
      );

      expect(unavailableCalls).toHaveLength(1);
    },
  );
});
