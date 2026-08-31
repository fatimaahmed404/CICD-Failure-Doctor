/**
 * Property-based tests for `truncateLog`
 *
 * Validates: Requirements 4.1, 4.2, 4.5
 *
 * Property 5a — For any string input, output cleanedLog contains no ANSI
 *               escape sequences.
 * Property 5b — For any input whose line count exceeds maxLines, the output
 *               line count is ≤ maxLines + 1 (the +1 is the truncation header).
 * Property 5c — For any input whose line count is ≤ maxLines, truncated = false.
 */

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { truncateLog } from "../src/logProcessor.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Regex that matches any CSI / OSC / ESC-based ANSI escape sequence. */
const ANSI_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/;

/**
 * Build a multi-line string from an array of lines, optionally injecting ANSI
 * colour codes around every third line so we exercise the strip path.
 */
function injectAnsi(lines: string[]): string {
  return lines
    .map((line, i) =>
      i % 3 === 0 ? `\x1b[31m${line}\x1b[0m` : line
    )
    .join("\n");
}

// ── Arbitraries ────────────────────────────────────────────────────────────────

/**
 * Generates an array of plain-text lines.  We avoid embedding literal '\n'
 * inside individual line strings because those would create unexpected extra
 * lines after join("\n"), which would make line-count reasoning very hard.
 */
const lineArb = fc.string({ maxLength: 120 }).filter((s) => !s.includes("\n"));

/**
 * Arbitrary: any log string (may contain ANSI codes injected around lines).
 * Produces between 0 and 600 lines so we cover both the under- and over-limit
 * branches.
 */
const anyLogArb = fc
  .array(lineArb, { minLength: 0, maxLength: 600 })
  .map(injectAnsi);

/**
 * Arbitrary: log string guaranteed to have MORE lines than `maxLines`.
 * We use maxLines = 50 to keep test generation fast; the property is
 * independent of the specific value chosen.
 */
const maxLines = 50;

const overLimitLogArb = fc
  .array(lineArb, { minLength: maxLines + 1, maxLength: 600 })
  .map(injectAnsi);

/**
 * Arbitrary: log string guaranteed to have AT MOST `maxLines` lines.
 */
const underLimitLogArb = fc
  .array(lineArb, { minLength: 0, maxLength: maxLines })
  .map(injectAnsi);

// ── Property 5a ────────────────────────────────────────────────────────────────

describe("Property 5a — cleanedLog contains no ANSI escape sequences", () => {
  /**
   * Validates: Requirements 4.1
   *
   * For ANY string input (with or without ANSI codes, any line count), the
   * cleanedLog returned by truncateLog must not contain any ANSI escape
   * sequences.
   */
  it("holds for arbitrary log strings", () => {
    fc.assert(
      fc.property(anyLogArb, (rawLog) => {
        const { cleanedLog } = truncateLog(rawLog);
        return !ANSI_RE.test(cleanedLog);
      }),
      { numRuns: 500 }
    );
  });

  it("holds when the log is a single long line with many ANSI codes", () => {
    fc.assert(
      fc.property(lineArb, (line) => {
        const rawLog = `\x1b[1m\x1b[31m${line}\x1b[0m\x1b[32m${line}\x1b[0m`;
        const { cleanedLog } = truncateLog(rawLog);
        return !ANSI_RE.test(cleanedLog);
      }),
      { numRuns: 300 }
    );
  });
});

// ── Property 5b ────────────────────────────────────────────────────────────────

describe("Property 5b — over-limit logs produce output line count ≤ maxLines + 1", () => {
  /**
   * Validates: Requirements 4.2
   *
   * When the raw log has more lines than maxLines, the output must be
   * capped at maxLines + 1 (the single truncation-header line counts as 1).
   */
  it("holds for logs that exceed maxLines", () => {
    fc.assert(
      fc.property(overLimitLogArb, (rawLog) => {
        const result = truncateLog(rawLog, { maxLines });
        const outputLineCount = result.cleanedLog.split("\n").length;
        return outputLineCount <= maxLines + 1;
      }),
      { numRuns: 500 }
    );
  });

  it("output line count ≤ maxLines + 1 for varying maxLines values", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100 }).chain((ml) =>
          fc
            .array(lineArb, { minLength: ml + 1, maxLength: ml + 300 })
            .map(injectAnsi)
            .map((log) => ({ log, ml }))
        ),
        ({ log, ml }) => {
          const result = truncateLog(log, {
            maxLines: ml,
            tailLines: Math.floor(ml * 0.7),
            keywordLines: Math.ceil(ml * 0.3),
          });
          const outputLineCount = result.cleanedLog.split("\n").length;
          return outputLineCount <= ml + 1;
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ── Property 5c ────────────────────────────────────────────────────────────────

describe("Property 5c — under-limit logs return truncated = false", () => {
  /**
   * Validates: Requirements 4.5
   *
   * When the raw log has ≤ maxLines lines, the result must have
   * truncated = false, indicating the full log was kept.
   */
  it("holds for logs within the line limit", () => {
    fc.assert(
      fc.property(underLimitLogArb, (rawLog) => {
        const result = truncateLog(rawLog, { maxLines });
        return result.truncated === false;
      }),
      { numRuns: 500 }
    );
  });

  it("truncated = false for the exact boundary (lineCount === maxLines)", () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: maxLines, maxLength: maxLines }),
        (lines) => {
          const rawLog = lines.join("\n");
          const result = truncateLog(rawLog, { maxLines });
          return result.truncated === false;
        }
      ),
      { numRuns: 200 }
    );
  });
});
