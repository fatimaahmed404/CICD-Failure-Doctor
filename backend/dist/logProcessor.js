/**
 * Log Processor
 *
 * Cleans and intelligently truncates raw build logs before sending to the LLM,
 * controlling token cost and staying within context limits.
 *
 * Design doc: Component 4 — Log Processor
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */
import stripAnsi from "strip-ansi";
// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_MAX_LINES = 300;
const DEFAULT_TAIL_LINES = 200;
const DEFAULT_KEYWORD_LINES = 100;
const DEFAULT_KEYWORDS = ["error", "fail", "exception", "fatal", "warning"];
// ── Control-character regex (excludes \n which we use as delimiter) ────────────
// Strips \r (carriage return), \b (backspace), \a (bell)
const CONTROL_CHARS_RE = /[\r\b\u0007]/g;
/**
 * Clean a single string: remove ANSI codes, then strip control characters.
 */
function cleanLine(raw) {
    return stripAnsi(raw).replace(CONTROL_CHARS_RE, "");
}
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
export function truncateLog(rawLog, options) {
    const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
    const tailLines = options?.tailLines ?? DEFAULT_TAIL_LINES;
    const keywordLines = options?.keywordLines ?? DEFAULT_KEYWORD_LINES;
    const keywords = options?.keywords ?? DEFAULT_KEYWORDS;
    // Split on newlines; keep trailing empty lines so we can reconstruct faithfully.
    const rawLineList = rawLog.split("\n");
    const originalLineCount = rawLineList.length;
    // Clean every line up front (strip ANSI + control chars).
    const cleanedLines = rawLineList.map(cleanLine);
    // ── Short-circuit: log fits within limit ─────────────────────────────────
    if (originalLineCount <= maxLines) {
        return {
            cleanedLog: cleanedLines.join("\n"),
            originalLineCount,
            truncated: false,
        };
    }
    // ── Phase 1: tail block ───────────────────────────────────────────────────
    // Always keep the last `tailLines` lines (clamped to maxLines so the tail
    // block alone cannot exceed the output limit).
    const effectiveTailLines = Math.min(tailLines, maxLines);
    const tailStartIndex = Math.max(0, originalLineCount - effectiveTailLines);
    // Build a Set of tail line indices for O(1) dedup lookup.
    const tailLineNumbers = new Set();
    for (let i = tailStartIndex; i < originalLineCount; i++) {
        tailLineNumbers.add(i);
    }
    // ── Phase 2: keyword block ────────────────────────────────────────────────
    // Walk from the top, collecting up to `keywordLines` matches not already in tail.
    // We use the *cleaned* line for matching since ANSI codes can obscure keywords.
    const keywordOnlyEntries = [];
    for (let i = 0; i < originalLineCount; i++) {
        if (keywordOnlyEntries.length >= keywordLines)
            break;
        if (tailLineNumbers.has(i))
            continue; // already covered by tail
        const lower = cleanedLines[i].toLowerCase();
        const matches = keywords.some((kw) => lower.includes(kw.toLowerCase()));
        if (matches) {
            keywordOnlyEntries.push({ lineNumber: i, text: cleanedLines[i] });
        }
    }
    // Phase 2 already skips tail lines, so no further dedup is needed.
    // Sort by original line number (they are collected top-to-bottom, so already sorted,
    // but we sort explicitly for correctness per spec).
    keywordOnlyEntries.sort((a, b) => a.lineNumber - b.lineNumber);
    // ── Phase 3: assemble output ──────────────────────────────────────────────
    const keywordBlock = keywordOnlyEntries.map((e) => e.text);
    const tailBlock = cleanedLines.slice(tailStartIndex); // original order
    const retainedCount = keywordBlock.length + tailBlock.length;
    const header = `[Log truncated: showing ${retainedCount} of ${originalLineCount} lines]`;
    const outputLines = [header, ...keywordBlock, ...tailBlock];
    const cleanedLog = outputLines.join("\n");
    return {
        cleanedLog,
        originalLineCount,
        truncated: true,
    };
}
//# sourceMappingURL=logProcessor.js.map