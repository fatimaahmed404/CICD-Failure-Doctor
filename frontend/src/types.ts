/**
 * Shared TypeScript interfaces for the frontend.
 */

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
