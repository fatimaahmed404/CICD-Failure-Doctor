/**
 * LLM Client — wraps the OpenAI API to produce structured CI/CD failure diagnoses.
 *
 * Exports:
 *   - `LLMParseError`   — thrown when the LLM response is not valid JSON or fails schema validation
 *   - `NetworkError`    — thrown on network failure, timeout (> 30 s), or 5xx from the LLM API
 *   - `diagnoseBuild()` — sends a prompt + cleaned log to the LLM and returns a validated DiagnosisResult
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */
import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import { z } from "zod";
// ── Typed errors ──────────────────────────────────────────────────────────────
/**
 * Thrown when the LLM returns a response that is not valid JSON,
 * is missing required fields, or fails Zod schema validation.
 * The `rawResponse` property holds the raw string returned by the LLM.
 *
 * Requirements: 5.3
 */
export class LLMParseError extends Error {
    rawResponse;
    constructor(message, rawResponse) {
        super(message);
        this.rawResponse = rawResponse;
        this.name = "LLMParseError";
    }
}
/**
 * Thrown when the LLM API call fails due to a network error, connection
 * timeout (> 30 s), or a 5xx response from the API.
 * The `cause` property holds the original error.
 *
 * Requirements: 5.3
 */
export class NetworkError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = "NetworkError";
    }
}
// ── Zod schema for DiagnosisResult ────────────────────────────────────────────
const FailureCategorySchema = z.enum([
    "dependency-build-error",
    "test-failure",
    "docker-build-failure",
    "env-var-secrets",
    "timeout-infrastructure",
    "syntax-lint-error",
    "unknown",
]);
/**
 * Validates the raw JSON object returned by the LLM against the DiagnosisResult
 * schema defined in the design document.
 *
 * Requirements: 5.4, 5.5
 */
const DiagnosisResultSchema = z.object({
    category: FailureCategorySchema,
    explanation: z.string().min(1, "explanation must be a non-empty string"),
    suggestedFix: z.string().min(1, "suggestedFix must be a non-empty string"),
    confidence: z.enum(["high", "medium", "low"]),
});
// ── System prompt ─────────────────────────────────────────────────────────────
/**
 * Builds the system prompt instructing the LLM to return only a valid JSON
 * object with the four required fields and no surrounding text.
 *
 * Requirements: 5.1
 */
function buildSystemPrompt() {
    return `You are a CI/CD failure analysis expert. Analyze the provided build log and \
return ONLY a JSON object with these fields:
{
  "category": one of [dependency-build-error, test-failure, docker-build-failure, \
env-var-secrets, timeout-infrastructure, syntax-lint-error, unknown],
  "explanation": "2-5 sentence plain-English root cause",
  "suggestedFix": "markdown string with concrete fix steps and corrected code/config where relevant",
  "confidence": one of [high, medium, low]
}
Do not include any text outside the JSON object.`;
}
/**
 * Builds the user message injecting the cleaned log and build metadata.
 *
 * Requirements: 5.1
 */
function buildUserMessage(input) {
    return `Repository: ${input.repoName}
Job: ${input.jobName}
Source: ${input.source}

Build log:
\`\`\`
${input.cleanedLog}
\`\`\``;
}
// ── OpenAI client (lazy singleton) ───────────────────────────────────────────
let _client = null;
function getClient() {
    if (!_client) {
        _client = new OpenAI({
            apiKey: process.env.LLM_API_KEY,
            baseURL: process.env.LLM_BASE_URL, // undefined = OpenAI's default, set this for Groq
            timeout: 30_000, // 30-second timeout per Req 5.3
        });
    }
    return _client;
}
// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Sends a structured prompt to the configured LLM and returns a validated
 * `DiagnosisResult`.
 *
 * @throws {LLMParseError}  — response is not valid JSON or fails schema validation
 * @throws {NetworkError}   — network failure, timeout, or 5xx from the LLM API
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
export async function diagnoseBuild(input) {
    const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
    const client = getClient();
    let raw;
    try {
        const response = await client.chat.completions.create({
            model,
            messages: [
                { role: "system", content: buildSystemPrompt() },
                { role: "user", content: buildUserMessage(input) },
            ],
            temperature: 0,
            response_format: { type: "json_object" },
        });
        raw = response.choices[0]?.message?.content ?? "";
    }
    catch (err) {
        // APIConnectionTimeoutError covers both connect-timeout and read-timeout
        if (err instanceof APIConnectionTimeoutError) {
            throw new NetworkError(`LLM API request timed out after 30 seconds`, err);
        }
        // APIError covers HTTP-level errors (4xx, 5xx) and connection failures
        if (err instanceof APIError) {
            throw new NetworkError(`LLM API error: ${err.status ?? "unknown"} — ${err.message}`, err);
        }
        // Unknown errors (e.g. DNS failure wrapped in a plain Error)
        throw new NetworkError(`Unexpected error calling LLM API: ${err instanceof Error ? err.message : String(err)}`, err);
    }
    // Parse JSON — Requirements: 5.2, 5.3
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new LLMParseError(`LLM response is not valid JSON`, raw);
    }
    // Validate schema — Requirements: 5.4, 5.5
    const result = DiagnosisResultSchema.safeParse(parsed);
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
        throw new LLMParseError(`LLM response failed schema validation: ${issues}`, raw);
    }
    return result.data;
}
//# sourceMappingURL=llmClient.js.map