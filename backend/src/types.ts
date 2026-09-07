/**
 * Shared TypeScript interfaces and types used across the backend.
 *
 * Sourced from the design document's Components and Data Models sections.
 */

// ── Enumerations ──────────────────────────────────────────────────────────────

export type BuildStatus = "pending" | "complete" | "unavailable";

export type FailureCategory =
  | "dependency-build-error"
  | "test-failure"
  | "docker-build-failure"
  | "env-var-secrets"
  | "timeout-infrastructure"
  | "syntax-lint-error"
  | "unknown";

export type ConfidenceLevel = "high" | "medium" | "low";

export type BuildSource = "github" | "jenkins" | "simulate";

export type SimulationScenario =
  | "test-failure"
  | "dependency-error"
  | "docker-build-failure"
  | "env-var-missing"
  | "timeout"
  | "lint-error";

// ── Core domain models ────────────────────────────────────────────────────────

export interface BuildRecord {
  id: string;                         // UUID v4
  repoName: string;
  jobName: string;
  commitSha: string;                  // 40- or 64-char hex
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
  retryCount: number;                 // 0 or 1
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
  userId: string | null;
}

// ── LLM interfaces ────────────────────────────────────────────────────────────

export interface DiagnosisInput {
  cleanedLog: string;
  repoName: string;
  jobName: string;
  source: BuildSource;
}

export interface DiagnosisResult {
  category: FailureCategory;
  explanation: string;      // plain-English, 2–5 sentences
  suggestedFix: string;     // markdown — may include code/config snippet
  confidence: ConfidenceLevel;
}

// ── Webhook / simulate payloads ───────────────────────────────────────────────

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

// ── API response shapes ───────────────────────────────────────────────────────

export interface DiagnosisSummary {
  id: string;
  repoName: string;
  jobName: string;
  commitSha: string;
  source: BuildSource;
  status: BuildStatus;
  category: FailureCategory | null;
  explanation: string | null;   // first sentence only
  confidence: ConfidenceLevel | null;
  createdAt: string;            // ISO 8601
  completedAt: string | null;
}

export interface DiagnosisDetail extends DiagnosisSummary {
  suggestedFix: string | null;  // full markdown
  rawLog: string;
  truncated: boolean;
}

export interface DiagnosisListResponse {
  data: DiagnosisSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Job queue ─────────────────────────────────────────────────────────────────

export interface DiagnosisJob {
  buildRecordId: string;
}

// ── Feedback (stretch) ────────────────────────────────────────────────────────

export type FeedbackRating = "helpful" | "unhelpful";

export interface FeedbackRecord {
  id: string;             // UUID v4
  buildRecordId: string;  // FK → build_records.id
  clientId: string;       // anonymous UUID from localStorage
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

// ── Log processor ─────────────────────────────────────────────────────────────

export interface TruncateOptions {
  maxLines?: number;       // default 300
  tailLines?: number;      // default 200
  keywordLines?: number;   // default 100
  keywords?: string[];     // default: ["error", "fail", "exception", "fatal", "warning"]
}

export interface TruncateResult {
  cleanedLog: string;
  originalLineCount: number;
  truncated: boolean;
}

// ── Authentication ─────────────────────────────────────────────────────────────

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

// Express namespace augmentation so TypeScript accepts req.user in route handlers
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
