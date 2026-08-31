/**
 * Unit tests for truncateLog
 *
 * Covers: empty string, under-limit, over-limit, ANSI-heavy, no keyword matches,
 * keyword/tail deduplication, and two-block ordering.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.6
 */

import { describe, it, expect } from "vitest";
import { truncateLog } from "../src/logProcessor.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a log string with `n` lines using the provided line factory. */
function makeLog(n: number, lineFn: (i: number) => string = (i) => `Line ${i}`): string {
  return Array.from({ length: n }, (_, i) => lineFn(i)).join("\n");
}

/** Strip ANSI escape sequences (same pattern as the implementation, for assertion). */
const ANSI_RE = /\x1B\[[0-9;]*[mGKHF]/g;
function hasAnsi(text: string): boolean {
  return ANSI_RE.test(text);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("truncateLog", () => {
  // ── 1. Empty string ─────────────────────────────────────────────────────────
  describe("empty string input", () => {
    it("returns truncated:false and an empty cleanedLog", () => {
      const result = truncateLog("");
      expect(result.truncated).toBe(false);
      expect(result.cleanedLog).toBe("");
      expect(result.originalLineCount).toBe(1); // "".split("\n") → [""]
    });
  });

  // ── 2. Under-limit log ──────────────────────────────────────────────────────
  describe("under-limit log (≤ maxLines)", () => {
    it("returns truncated:false and all lines when count equals maxLines", () => {
      const maxLines = 300;
      const log = makeLog(maxLines);
      const result = truncateLog(log, { maxLines });

      expect(result.truncated).toBe(false);
      expect(result.originalLineCount).toBe(maxLines);
      // All content lines must be present in the output (order preserved)
      const outputLines = result.cleanedLog.split("\n");
      expect(outputLines.length).toBe(maxLines);
    });

    it("returns the full cleaned log when count is well under the limit", () => {
      const log = makeLog(50);
      const result = truncateLog(log, { maxLines: 300 });

      expect(result.truncated).toBe(false);
      expect(result.originalLineCount).toBe(50);
      expect(result.cleanedLog).toBe(log); // no ANSI, no modifications
    });

    it("originalLineCount matches the actual number of lines", () => {
      const log = "a\nb\nc";
      const result = truncateLog(log);
      expect(result.originalLineCount).toBe(3);
    });
  });

  // ── 3. Over-limit log ───────────────────────────────────────────────────────
  describe("over-limit log (> maxLines)", () => {
    it("returns truncated:true when line count exceeds maxLines", () => {
      const log = makeLog(400);
      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });

      expect(result.truncated).toBe(true);
    });

    it("output line count is ≤ maxLines + 1 (header counts as one line)", () => {
      const log = makeLog(500);
      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });

      const outputLines = result.cleanedLog.split("\n");
      expect(outputLines.length).toBeLessThanOrEqual(301);
    });

    it("output starts with a truncation header line", () => {
      const log = makeLog(400);
      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });

      const firstLine = result.cleanedLog.split("\n")[0];
      expect(firstLine).toMatch(/^\[Log truncated: showing \d+ of \d+ lines\]$/);
    });

    it("header reports the correct original line count", () => {
      const log = makeLog(400);
      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });

      expect(result.cleanedLog).toContain("of 400 lines]");
      expect(result.originalLineCount).toBe(400);
    });
  });

  // ── 4. ANSI-heavy log ───────────────────────────────────────────────────────
  describe("ANSI-heavy log", () => {
    it("output contains no ANSI escape codes for an under-limit ANSI log", () => {
      const ansiLine = "\x1B[31mERROR: build failed\x1B[0m";
      const log = Array(50).fill(ansiLine).join("\n");

      const result = truncateLog(log, { maxLines: 300 });

      expect(hasAnsi(result.cleanedLog)).toBe(false);
    });

    it("output contains no ANSI escape codes for an over-limit ANSI log", () => {
      const ansiLine = "\x1B[32mok\x1B[0m";
      const log = Array(400).fill(ansiLine).join("\n");

      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });

      expect(hasAnsi(result.cleanedLog)).toBe(false);
    });

    it("strips \\r carriage returns from every line", () => {
      const log = Array(10).fill("step passed\r").join("\n");
      const result = truncateLog(log);

      expect(result.cleanedLog).not.toContain("\r");
    });

    it("preserves the text content after stripping ANSI codes", () => {
      const log = "\x1B[31mERROR\x1B[0m: something failed";
      const result = truncateLog(log);

      expect(result.cleanedLog).toContain("ERROR: something failed");
    });
  });

  // ── 5. No keyword matches ────────────────────────────────────────────────────
  describe("log with no keyword matches", () => {
    it("over-limit log with zero keyword lines still returns truncated:true", () => {
      // All lines are plain text with no error/fail/exception/fatal/warning keywords.
      const log = makeLog(400, (i) => `Step ${i}: success`);
      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });

      expect(result.truncated).toBe(true);
    });

    it("output contains only the header + tail block when no keyword lines match", () => {
      const log = makeLog(400, (i) => `Step ${i}: success`);
      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });

      const lines = result.cleanedLog.split("\n");
      // header + 200 tail lines = 201 lines total
      expect(lines.length).toBe(201);
    });

    it("header shows the tail-only count correctly", () => {
      const log = makeLog(400, (i) => `Step ${i}: success`);
      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });

      expect(result.cleanedLog).toContain("showing 200 of 400 lines");
    });
  });

  // ── 6. Deduplication: keyword lines that overlap the tail ───────────────────
  describe("keyword/tail overlap deduplication", () => {
    it("a keyword line in the tail is NOT duplicated in the keyword block", () => {
      // Build a 400-line log where the last 10 lines contain "error".
      // All "error" lines fall within the tail window (last 200), so the keyword
      // block should be empty.
      const lines = Array.from({ length: 400 }, (_, i) =>
        i >= 390 ? `error on step ${i}` : `Step ${i}: success`
      );
      const log = lines.join("\n");

      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });
      const outputLines = result.cleanedLog.split("\n");

      // Count how many output lines contain "error"
      const errorLines = outputLines.filter((l) => l.includes("error on step"));
      // There are 10 "error" lines in the log; all are in the tail.
      // They should appear exactly once in the output.
      expect(errorLines.length).toBe(10);
    });

    it("each line appears at most once in the output", () => {
      const lines = Array.from({ length: 350 }, (_, i) =>
        i % 5 === 0 ? `ERROR: step ${i} failed` : `Step ${i}: ok`
      );
      const log = lines.join("\n");

      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });
      const outputLines = result.cleanedLog.split("\n").slice(1); // skip header

      const seen = new Set<string>();
      for (const line of outputLines) {
        expect(seen.has(line)).toBe(false);
        seen.add(line);
      }
    });
  });

  // ── 7. Two-block ordering ────────────────────────────────────────────────────
  describe("two-block ordering: keyword-only block before tail block", () => {
    it("keyword-only lines (from top of log) appear before the tail lines", () => {
      // 400 lines:
      //   - Lines 0–9:   "error early line N"  → keyword candidates, outside tail window
      //   - Lines 10–199: "normal line N"       → not keyword, not in tail
      //   - Lines 200–399: tail window (last 200 lines)
      //     Lines 200–209 also contain "error" but will be deduplicated into tail only.
      const lines = Array.from({ length: 400 }, (_, i) => {
        if (i < 10) return `error early line ${i}`;
        if (i >= 200 && i < 210) return `error tail line ${i}`;
        return `normal line ${i}`;
      });
      const log = lines.join("\n");

      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });
      const outputLines = result.cleanedLog.split("\n");

      // outputLines[0] = header
      // outputLines[1..10] = keyword-only block (the 10 "error early" lines)
      // outputLines[11..210] = tail block (lines 200–399)

      // Verify keyword-only block comes first
      for (let i = 1; i <= 10; i++) {
        expect(outputLines[i]).toMatch(/^error early line/);
      }

      // Verify tail block starts immediately after keyword block.
      // The first tail line is input line 200 = "error tail line 200".
      expect(outputLines[11]).toBe("error tail line 200");

      // Verify a later tail line is in correct position (input line 210 = "normal line 210")
      expect(outputLines[21]).toBe("normal line 210");
    });

    it("keyword-only lines are sorted by original line number", () => {
      // Interleave keyword lines near the top: lines 5, 15, 25 have "fatal".
      const lines = Array.from({ length: 400 }, (_, i) => {
        if (i === 5 || i === 15 || i === 25) return `fatal error at step ${i}`;
        return `normal line ${i}`;
      });
      const log = lines.join("\n");

      const result = truncateLog(log, { maxLines: 300, tailLines: 200, keywordLines: 100 });
      const outputLines = result.cleanedLog.split("\n");

      // outputLines[0] = header; [1], [2], [3] = the three fatal lines in order
      expect(outputLines[1]).toBe("fatal error at step 5");
      expect(outputLines[2]).toBe("fatal error at step 15");
      expect(outputLines[3]).toBe("fatal error at step 25");
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("single-line log under limit returns that line with truncated:false", () => {
      const result = truncateLog("single line");
      expect(result.truncated).toBe(false);
      expect(result.cleanedLog).toBe("single line");
      expect(result.originalLineCount).toBe(1);
    });

    it("respects custom keywords option", () => {
      const lines = Array.from({ length: 400 }, (_, i) =>
        i < 5 ? `CRITICAL: failure at ${i}` : `normal line ${i}`
      );
      const log = lines.join("\n");

      const result = truncateLog(log, {
        maxLines: 300,
        tailLines: 200,
        keywordLines: 100,
        keywords: ["critical"],
      });

      // The 5 CRITICAL lines should appear in the keyword block
      expect(result.cleanedLog).toContain("CRITICAL: failure at 0");
    });

    it("respects custom maxLines option", () => {
      const log = makeLog(20);
      const result = truncateLog(log, { maxLines: 10, tailLines: 8, keywordLines: 2 });

      expect(result.truncated).toBe(true);
      const outputLines = result.cleanedLog.split("\n");
      expect(outputLines.length).toBeLessThanOrEqual(11); // maxLines + 1
    });
  });
});
