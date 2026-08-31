/**
 * ingestBuild service
 *
 * Validates an incoming build payload, persists a BuildRecord with
 * `status = "pending"`, enqueues the async diagnosis job, and returns
 * the created record — all within ~200 ms (no LLM work on this path).
 *
 * Requirements: 1.1, 1.3, 1.4, 10.2, 10.3, 10.4
 */
import type { BuildRecord, BuildSource, WebhookPayload } from "../types.js";
/**
 * Payload shape produced by the /simulate route.
 * Identical to WebhookPayload but without a `source` field (source is always
 * "simulate" and is passed separately to ingestBuild).
 */
export interface SimulatePayload {
    log: string;
    repoName: string;
    jobName: string;
    commitSha: string;
    branch?: string;
}
/**
 * Thrown by `ingestBuild` when one or more required fields fail validation.
 * The route handler maps this to HTTP 400 `{ error, details }`.
 */
export declare class IngestValidationError extends Error {
    readonly details: string[];
    constructor(details: string[]);
}
/**
 * Validates `payload` + `source`, persists a pending BuildRecord, enqueues
 * the diagnosis job, and returns the record.
 *
 * Throws `IngestValidationError` when any field is invalid.
 *
 * Requirements: 1.1, 1.3, 1.4, 10.2, 10.3, 10.4
 */
export declare function ingestBuild(payload: WebhookPayload | SimulatePayload, source: BuildSource): Promise<BuildRecord>;
//# sourceMappingURL=ingestBuild.d.ts.map