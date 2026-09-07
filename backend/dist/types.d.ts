/**
 * Shared TypeScript interfaces and types used across the backend.
 *
 * Sourced from the design document's Components and Data Models sections.
 */
export type BuildStatus = "pending" | "complete" | "unavailable";
export type FailureCategory = "dependency-build-error" | "test-failure" | "docker-build-failure" | "env-var-secrets" | "timeout-infrastructure" | "syntax-lint-error" | "unknown";
export type ConfidenceLevel = "high" | "medium" | "low";
export type BuildSource = "github" | "jenkins" | "simulate";
export type SimulationScenario = "test-failure" | "dependency-error" | "docker-build-failure" | "env-var-missing" | "timeout" | "lint-error";
export interface BuildRecord {
    id: string;
    repoName: string;
    jobName: string;
    commitSha: string;
    branch: string | null;
    source: BuildSource;
    rawLog: string;
    cleanedLog: string | null;
    truncated: boolean;
    status: BuildStatus;
    category: FailureCategory | null;
    explanation: string | null;
    suggestedFix: string | null;
    confidence: ConfidenceLevel | null;
    retryCount: number;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
    userId: string | null;
}
export interface DiagnosisInput {
    cleanedLog: string;
    repoName: string;
    jobName: string;
    source: BuildSource;
}
export interface DiagnosisResult {
    category: FailureCategory;
    explanation: string;
    suggestedFix: string;
    confidence: ConfidenceLevel;
}
export interface WebhookPayload {
    log: string;
    repoName: string;
    jobName: string;
    commitSha: string;
    source: "github" | "jenkins";
    branch?: string;
}
export interface SimulateRequest {
    scenario?: SimulationScenario;
}
export interface DiagnosisSummary {
    id: string;
    repoName: string;
    jobName: string;
    commitSha: string;
    source: BuildSource;
    status: BuildStatus;
    category: FailureCategory | null;
    explanation: string | null;
    confidence: ConfidenceLevel | null;
    createdAt: string;
    completedAt: string | null;
}
export interface DiagnosisDetail extends DiagnosisSummary {
    suggestedFix: string | null;
    rawLog: string;
    truncated: boolean;
}
export interface DiagnosisListResponse {
    data: DiagnosisSummary[];
    total: number;
    page: number;
    pageSize: number;
}
export interface DiagnosisJob {
    buildRecordId: string;
}
export type FeedbackRating = "helpful" | "unhelpful";
export interface FeedbackRecord {
    id: string;
    buildRecordId: string;
    clientId: string;
    rating: FeedbackRating;
    createdAt: Date;
}
export interface FailureCategoryStats {
    category: FailureCategory;
    helpful: number;
    unhelpful: number;
}
export interface FeedbackStatsResponse {
    stats: FailureCategoryStats[];
}
export interface TruncateOptions {
    maxLines?: number;
    tailLines?: number;
    keywordLines?: number;
    keywords?: string[];
}
export interface TruncateResult {
    cleanedLog: string;
    originalLineCount: number;
    truncated: boolean;
}
export interface UserRecord {
    id: string;
    email: string;
    passwordHash: string;
    webhookSecret: string;
    createdAt: number;
}
export interface AuthenticatedUser {
    userId: string;
    email: string;
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthenticatedUser;
        }
    }
}
//# sourceMappingURL=types.d.ts.map