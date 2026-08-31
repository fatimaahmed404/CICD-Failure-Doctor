/**
 * Diagnoses API routes.
 *
 * GET /diagnoses        — paginated + filtered list of DiagnosisSummary objects
 * GET /diagnoses/:id    — full DiagnosisDetail for a single record
 * GET /health           — uptime-monitor ping
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 11.4
 */

import { Router, Request, Response } from "express";
import {
  getBuildRecordById,
  listBuildRecords,
} from "../db/buildRecords.js";
import type {
  BuildRecord,
  DiagnosisSummary,
  DiagnosisDetail,
  DiagnosisListResponse,
  FailureCategory,
} from "../types.js";

const router = Router();

// ── Valid FailureCategory values (kept in sync with types.ts) ─────────────────

const VALID_CATEGORIES: ReadonlySet<string> = new Set<FailureCategory>([
  "dependency-build-error",
  "test-failure",
  "docker-build-failure",
  "env-var-secrets",
  "timeout-infrastructure",
  "syntax-lint-error",
  "unknown",
]);

// ── Mappers ───────────────────────────────────────────────────────────────────

/**
 * Extracts the first sentence from an explanation string.
 * Returns null if explanation is null.
 */
function firstSentence(explanation: string | null): string | null {
  if (!explanation) return null;
  const match = explanation.match(/^[^.!?]*[.!?]/);
  return match ? match[0].trim() : explanation.trim();
}

function toSummary(record: BuildRecord): DiagnosisSummary {
  return {
    id: record.id,
    repoName: record.repoName,
    jobName: record.jobName,
    commitSha: record.commitSha,
    source: record.source,
    status: record.status,
    category: record.category,
    explanation: firstSentence(record.explanation),
    confidence: record.confidence,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
  };
}

function toDetail(record: BuildRecord): DiagnosisDetail {
  return {
    ...toSummary(record),
    suggestedFix: record.suggestedFix,
    rawLog: record.rawLog,
    truncated: record.truncated,
  };
}

// ── GET /diagnoses ─────────────────────────────────────────────────────────────

/**
 * Returns a paginated, optionally category-filtered list of DiagnosisSummary objects.
 *
 * Query params:
 *   page     — 1-based page number (default 1)
 *   limit    — page size, 1–100 (default 20)
 *   category — optional FailureCategory filter
 *
 * Requirements: 7.1, 7.2, 7.5, 7.6, 7.7
 */
router.get("/", (req: Request, res: Response): void => {
  const rawPage = req.query.page;
  const rawLimit = req.query.limit;
  const rawCategory = req.query.category;

  // Validate category if provided (Req 7.7)
  if (rawCategory !== undefined && rawCategory !== null && rawCategory !== "") {
    if (!VALID_CATEGORIES.has(rawCategory as string)) {
      res.status(400).json({ error: `Invalid category: "${rawCategory}"` });
      return;
    }
  }

  const page = rawPage ? Math.max(1, parseInt(rawPage as string, 10) || 1) : 1;
  const limit = rawLimit
    ? Math.min(100, Math.max(1, parseInt(rawLimit as string, 10) || 20))
    : 20;

  const category =
    rawCategory && VALID_CATEGORIES.has(rawCategory as string)
      ? (rawCategory as FailureCategory)
      : null;

  const result = listBuildRecords({ page, limit, category });

  const response: DiagnosisListResponse = {
    data: result.data.map(toSummary),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  };

  res.status(200).json(response);
});

// ── GET /diagnoses/:id ────────────────────────────────────────────────────────

/**
 * Returns the full DiagnosisDetail for a single record.
 * Returns 404 when no record with the given id exists.
 *
 * Requirements: 7.3, 7.4
 */
router.get("/:id", (req: Request, res: Response): void => {
  const id = req.params["id"] as string;

  const record = getBuildRecordById(id);
  if (!record) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.status(200).json(toDetail(record));
});

export { router as diagnosesRouter };
