/**
 * Log Processor
 *
 * Cleans and intelligently truncates raw build logs before sending to the LLM,
 * controlling token cost and staying within context limits.
 *
 * Design doc: Component 4 — Log Processor
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */
import type { TruncateOptions, TruncateResult } from "./types.js";
/**
 * Truncate and clean a raw build log.
 *
 * - Strips ANSI escape codes and \r / \b / \a control characters from every line.
 * - If the log is within `maxLines`, returns the full cleaned log with `truncated: false`.
 * - If the log exceeds `maxLines`:
 *   1. Collects the last `tailLines` lines (tail block).
 *   2. Collects up to `keywordLines` lines matching any keyword (case-insensitive)
 *      that are NOT already in the tail set (keyword-only block).
 *   3. Sorts the keyword-only block by original line number.
 *   4. Outputs: [truncation header] + keyword-only block + tail block.
 *   5. Total output lines ≤ maxLines + 1 (header counts as one line).
 */
export declare function truncateLog(rawLog: string, options?: TruncateOptions): TruncateResult;
//# sourceMappingURL=logProcessor.d.ts.map