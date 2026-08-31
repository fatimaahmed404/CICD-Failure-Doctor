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
import type { DiagnosisInput, DiagnosisResult } from "./types.js";
/**
 * Thrown when the LLM returns a response that is not valid JSON,
 * is missing required fields, or fails Zod schema validation.
 * The `rawResponse` property holds the raw string returned by the LLM.
 *
 * Requirements: 5.3
 */
export declare class LLMParseError extends Error {
    readonly rawResponse: string;
    constructor(message: string, rawResponse: string);
}
/**
 * Thrown when the LLM API call fails due to a network error, connection
 * timeout (> 30 s), or a 5xx response from the API.
 * The `cause` property holds the original error.
 *
 * Requirements: 5.3
 */
export declare class NetworkError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
/**
 * Sends a structured prompt to the configured LLM and returns a validated
 * `DiagnosisResult`.
 *
 * @throws {LLMParseError}  — response is not valid JSON or fails schema validation
 * @throws {NetworkError}   — network failure, timeout, or 5xx from the LLM API
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
export declare function diagnoseBuild(input: DiagnosisInput): Promise<DiagnosisResult>;
//# sourceMappingURL=llmClient.d.ts.map