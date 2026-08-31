# Implementation Plan: CI/CD Failure Doctor

## Overview

Full-stack TypeScript web application: Node.js/Express backend with SQLite persistence, async LLM-based log analysis via a job queue, and a React/Vite dashboard. Tasks are ordered so each one is unblocked by the time its dependencies complete. Stretch features (Notifications, Helpfulness Feedback) are isolated at the end and marked optional.

---

## Tasks

- [x] 1. Project scaffold
  - [x] 1.1 Initialize monorepo directory structure with `backend/` and `frontend/` workspaces
    - Create `backend/` with `src/`, `tests/`, `fixtures/` directories
    - Create `frontend/` with `src/` directory
    - Add root `package.json` with `workspaces` field pointing to both packages
    - _Requirements: 11.4_

  - [x] 1.2 Configure TypeScript for backend and frontend
    - Add `backend/tsconfig.json` targeting ES2022, `moduleResolution: "Node16"`, `outDir: "dist"`, `strict: true`
    - Add `frontend/tsconfig.json` targeting ESNext with Vite-compatible settings
    - Add root-level `tsconfig.base.json` with shared strict settings
    - _Requirements: 11.4_

  - [x] 1.3 Install and configure backend dependencies
    - Add `express`, `better-sqlite3`, `uuid`, `p-queue`, `openai`, `zod`, `strip-ansi`, `cors`, `express-rate-limit`, `nodemailer` (pinned versions) to `backend/package.json`
    - Add `@types/*` dev dependencies and `vitest`, `supertest`, `fast-check`, `typescript`
    - Add `backend/package.json` scripts: `build`, `start`, `dev`, `test`
    - _Requirements: 11.4_

  - [x] 1.4 Install and configure frontend dependencies
    - Add `react`, `react-dom`, `react-markdown`, `vite` (pinned versions) to `frontend/package.json`
    - Add `@types/react`, `@types/react-dom`, `typescript`, `vitest` as dev dependencies
    - Add `frontend/vite.config.ts` with dev server proxy for `/api` → `http://localhost:3000`
    - _Requirements: 11.4_

  - [x] 1.5 Create `.env.example` at repo root
    - Include all variables from the design's environment variables reference section: `WEBHOOK_SECRET`, `LLM_API_KEY`, `LLM_MODEL`, `DATABASE_PATH`, `PORT`, `SLACK_WEBHOOK_URL`, `NOTIFICATION_EMAIL`, `APP_BASE_URL`
    - Add inline comments explaining each variable
    - _Requirements: 11.1, 11.2_

---

- [x] 2. Database layer
  - [x] 2.1 Implement SQLite initialization and schema
    - Create `backend/src/db/init.ts` that opens the SQLite file at `DATABASE_PATH` (defaulting to `./data/cicd-doctor.db`), enables WAL mode, and runs the `CREATE TABLE IF NOT EXISTS build_records` DDL from the design document
    - Include all CHECK constraints (`status`, `source`, `confidence`) and the three indexes (`idx_build_records_status`, `idx_build_records_created`, `idx_build_records_category`)
    - Export a `db` singleton for use across the backend
    - _Requirements: 10.1, 10.5, 10.7, 11.3_

  - [x] 2.2 Implement BuildRecord data-access functions
    - Create `backend/src/db/buildRecords.ts` with typed functions: `insertBuildRecord`, `getBuildRecordById`, `updateBuildRecord`, `listBuildRecords` (pagination + category filter)
    - Enforce UUID v4 generation on insert (via `uuid` package)
    - Validate `commitSha` as 40- or 64-char hex before insert; throw a typed error if invalid
    - Validate `source` is one of `"github" | "jenkins" | "simulate"` before insert; throw if invalid
    - Set `completedAt` only on transitions to `"complete"` or `"unavailable"`
    - _Requirements: 10.2, 10.3, 10.4, 10.6_

---

- [x] 3. Startup validation
  - [x] 3.1 Implement boot-time environment variable guard
    - Create `backend/src/startup.ts` that iterates `["WEBHOOK_SECRET", "LLM_API_KEY"]`, logs `[startup] Missing required environment variable: <KEY>` for each missing variable, and calls `process.exit(1)` if any are absent
    - Call this module as the first statement in `backend/src/server.ts` before any middleware or route registration
    - _Requirements: 11.2_

---

- [x] 4. Webhook authentication
  - [x] 4.1 Implement `validateWebhookRequest`
    - Create `backend/src/auth/validateWebhook.ts` exporting `validateWebhookRequest(req): { valid: boolean; statusCode: 401 | 500 | null }`
    - If `WEBHOOK_SECRET` env var is absent or empty at call time: return `{ valid: false, statusCode: 500 }` and log an error (defense-in-depth fallback; startup check is the primary guard)
    - If `X-Webhook-Secret` header is missing or empty: return `{ valid: false, statusCode: 401 }`
    - Compare header to `WEBHOOK_SECRET` using `crypto.timingSafeEqual` (after encoding both to `Buffer`); return `{ valid: true }` on match, `{ valid: false, statusCode: 401 }` on mismatch
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 1.2, 1.5_

  - [x] 4.2 Write unit tests for `validateWebhookRequest`
    - Test: missing header → 401, wrong value → 401, correct value → valid, empty `WEBHOOK_SECRET` → 500
    - _Requirements: 9.3, 9.4, 9.5_

---

- [x] 5. Log Processor
  - [x] 5.1 Implement `truncateLog`
    - Create `backend/src/logProcessor.ts` exporting `truncateLog(rawLog: string, options?: TruncateOptions): TruncateResult`
    - Use `strip-ansi` to remove ANSI escape codes; also strip `\r`, `\b`, `\a` control characters
    - If line count ≤ `maxLines` (default 300): return full cleaned log with `truncated: false`
    - If line count > `maxLines`: collect the final `tailLines` (default 200) lines, then up to `keywordLines` (default 100) lines matching any of `["error", "fail", "exception", "fatal", "warning"]` as case-insensitive substring
    - Deduplicate: remove from keyword set any lines whose `lineNumber` already appears in the tail set
    - Sort keyword-only lines by original line number, then append tail lines (original order)
    - Prepend `[Log truncated: showing N of M lines]` header (N = retained unique lines, M = original count)
    - Ensure total output line count ≤ `maxLines + 1`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 5.2 Write property tests for `truncateLog` (fast-check)
    - **Property 5a**: For any string input, output contains no ANSI escape sequences
    - **Property 5b**: For any input with `lineCount > maxLines`, output line count ≤ `maxLines + 1`
    - **Property 5c**: For any input with `lineCount ≤ maxLines`, `truncated = false`
    - **Validates: Requirements 4.1, 4.2, 4.5**

  - [x] 5.3 Write unit tests for `truncateLog`
    - Test: empty string, under-limit log, over-limit log, ANSI-heavy log, log with no keyword matches, keyword lines that overlap tail lines (deduplication), two-block ordering (keyword block before tail block)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_

---

- [x] 6. LLM Client
  - [x] 6.1 Implement `diagnoseBuild` and typed errors
    - Create `backend/src/llmClient.ts` with `LLMParseError` and `NetworkError` typed error classes
    - Implement `diagnoseBuild(input: DiagnosisInput): Promise<DiagnosisResult>`
    - Build system prompt instructing LLM to return only a JSON object with `category`, `explanation`, `suggestedFix`, `confidence` — no surrounding text
    - Use the `openai` package; set `temperature: 0`, `response_format: { type: "json_object" }`, timeout 30 seconds
    - Use `zod` to validate the parsed response against `DiagnosisResult` schema (7 categories, 3 confidence levels, non-empty explanation string)
    - Throw `LLMParseError` for invalid JSON or schema validation failures; throw `NetworkError` for network/timeout/5xx errors
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 6.2 Write unit tests for `diagnoseBuild`
    - Test: valid JSON response → returns `DiagnosisResult`, invalid JSON → throws `LLMParseError`, missing required field → throws `LLMParseError`, network timeout → throws `NetworkError`
    - _Requirements: 5.2, 5.3_

---

- [x] 7. Async Job Queue
  - [x] 7.1 Implement `processJob` with retry and SLA watchdog
    - Create `backend/src/jobQueue.ts` using `p-queue` with `concurrency: 2`
    - Implement `processJob(job: DiagnosisJob): Promise<void>`:
      - Fetch `BuildRecord` by ID; if not found, log and return
      - Call `truncateLog(record.rawLog)` and persist `cleanedLog` + `truncated` to the record
      - Attempt `diagnoseBuild`; on `NetworkError` (transient): wait 1 second, retry once; on `LLMParseError` (parse failure): do NOT retry — immediately set `status = "unavailable"` with `errorMessage` and `completedAt`
      - On success: update record to `status = "complete"` with all DiagnosisResult fields and `completedAt`; fire-and-forget `notificationService.notify()` wrapped in a try/catch that only logs errors
      - After both attempts exhausted for `NetworkError`: set `status = "unavailable"` with `errorMessage` and `completedAt`; ensure `retryCount` reflects actual attempts (0 or 1)
    - Wrap each `processJob` call in a `Promise.race` against a 120-second timeout; on timeout: force `status = "unavailable"` with `errorMessage = "Diagnosis SLA timeout: exceeded 120 s"` and `completedAt = now()`
    - Export `enqueue(job: DiagnosisJob): void`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.2, 6.3, 6.4_

  - [x] 7.2 Write unit tests for `processJob`
    - Test: success on first attempt (status=complete, all fields set), success on retry (NetworkError then success), failure after both attempts (NetworkError twice → unavailable), LLMParseError → unavailable immediately (no retry), missing build record → no-op, SLA timeout → unavailable with correct errorMessage
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 6.1, 6.2, 6.4_

---

- [x] 8. Simulation fixtures
  - [x] 8.1 Create bundled fixture files for all six scenarios
    - Create `backend/fixtures/` directory with one realistic log file per scenario:
      - `test-failure.log` — output showing failing unit tests with assertion errors
      - `dependency-error.log` — npm/pip install errors with missing package or version conflict
      - `docker-build-failure.log` — Dockerfile build error (COPY/RUN failure)
      - `env-var-missing.log` — runtime crash due to undefined environment variable reference
      - `timeout.log` — build/test step that exceeds runner time limit
      - `lint-error.log` — ESLint/prettier failures with file and line references
    - Each fixture must be a realistic multi-line log (≥ 50 lines) that exercises the full truncation and LLM path
    - _Requirements: 2.4, 2.5_

---

- [x] 9. Webhook Ingestion Handler + Simulate Handler + ingestBuild service
  - [x] 9.1 Implement `ingestBuild` service function
    - Create `backend/src/services/ingestBuild.ts` exporting `ingestBuild(payload: WebhookPayload | SimulatePayload, source: "github" | "jenkins" | "simulate"): Promise<BuildRecord>`
    - Validate all required fields are non-empty and non-whitespace-only; validate `commitSha` matches `/^[0-9a-f]{40}$|^[0-9a-f]{64}$/i`; validate `source` is in allowed enum
    - Generate UUID v4 for `id`, persist a BuildRecord with `status = "pending"`, call `enqueue({ buildRecordId: id })`, return the record — all within < 200 ms (no LLM call)
    - _Requirements: 1.1, 1.3, 1.4, 10.2, 10.3, 10.4_

  - [x] 9.2 Implement `POST /webhook/ingest` route
    - Create `backend/src/routes/webhook.ts`
    - Apply Express body parser with 10 MB limit; return 413 with `{ error: "Payload too large" }` when exceeded
    - Call `validateWebhookRequest`; return 401 or 500 per its result
    - Call `ingestBuild`; return 400 with `{ error, details: string[] }` on validation failure
    - Validate `source` is exactly `"github"` or `"jenkins"` (case-sensitive); return 400 on invalid value
    - Return 202 `{ id, status: "pending" }` on success
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7_

  - [x] 9.3 Implement `POST /simulate` route
    - Create `backend/src/routes/simulate.ts`
    - Default `scenario` to `"test-failure"` when absent; reject unknown scenario values with 400 and `{ error, details }`
    - Load the corresponding fixture file from `backend/fixtures/`; inject synthetic metadata (`repoName: "demo/repo"`, `jobName: "CI / simulate"`, a deterministic `commitSha`)
    - Call `ingestBuild(payload, "simulate")`; return 202 `{ id, scenario, status: "pending" }`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 9.4 Write unit tests for `ingestBuild`
    - Test: happy path (record inserted, status=pending, job enqueued), missing required field → validation error, whitespace-only field → validation error, invalid commitSha format → validation error
    - _Requirements: 1.1, 1.3, 10.2, 10.3_

---

- [x] 10. Diagnoses API + Health endpoint
  - [x] 10.1 Implement `GET /diagnoses` with pagination and filtering
    - Create `backend/src/routes/diagnoses.ts`
    - Parse `page` (default 1), `limit` (default 20, max 100), `category` query params
    - If `category` is provided but not a valid `FailureCategory` value: return 400
    - If `page` is beyond total record count: return 200 with `{ data: [], total, page, pageSize }` (not an error)
    - Query `build_records` via `listBuildRecords` sorted by `created_at DESC`; map each row to `DiagnosisSummary` (first sentence of `explanation` only)
    - Return `{ data, total, page, pageSize }`
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 7.7_

  - [x] 10.2 Implement `GET /diagnoses/:id` and `GET /health`
    - Add route `GET /diagnoses/:id`: call `getBuildRecordById`; return 404 `{ error: "Not found" }` for unknown IDs; map to `DiagnosisDetail` (includes `suggestedFix`, `rawLog`, `truncated`) for known IDs
    - Add route `GET /health`: return 200 `{ status: "ok" }` — used by uptime monitors to prevent free-tier cold starts
    - _Requirements: 7.3, 7.4, 11.4_

  - [x] 10.3 Write Supertest integration tests for all API routes
    - Test `/webhook/ingest`: valid request → 202, missing secret → 401, missing field → 400, invalid source → 400, oversized payload → 413
    - Test `/simulate`: valid scenario → 202, invalid scenario → 400, default scenario → 202 with `scenario: "test-failure"`
    - Test `/diagnoses`: pagination defaults, `limit` capped at 100, `category` filter, out-of-range page → 200 empty, invalid category → 400
    - Test `/diagnoses/:id`: existing record → 200 with all fields, unknown ID → 404
    - Test end-to-end: `POST /simulate` → poll `GET /diagnoses` → verify `status = "complete"` (mock LLM client to return a fixed `DiagnosisResult`)
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7, 2.1, 2.2, 7.1–7.7_

---

- [x] 11. CORS and rate limiting
  - [x] 11.1 Configure CORS middleware
    - In `backend/src/server.ts`, apply `cors({ origin: ['https://your-app.vercel.app', 'http://localhost:5173'] })` — read allowed origin(s) from `CORS_ORIGIN` env var (comma-separated), falling back to localhost only; do NOT use wildcard `*`
    - Apply CORS middleware before all routes
    - _Requirements: security considerations (design doc)_

  - [x] 11.2 Configure per-IP rate limiting
    - Apply `express-rate-limit` to `POST /webhook/ingest` and `POST /simulate`: 20 requests per minute per IP; return 429 with `{ error: "Too many requests" }` when exceeded
    - _Requirements: security considerations (design doc)_

---

- [x] 12. Express server wiring
  - [x] 12.1 Wire all routes and middleware in `server.ts`
    - Call `startup.ts` validation first
    - Initialize SQLite db via `db/init.ts`
    - Apply `cors`, `express.json({ limit: "10mb" })`, `express-rate-limit` middleware in order
    - Mount `/webhook/ingest`, `/simulate`, `/diagnoses`, `/health` routes
    - Add global error handler middleware (catch unhandled errors, return 500 `{ error: "Internal server error" }`)
    - Start listening on `PORT` (default 3000)
    - _Requirements: 11.1, 11.2, 11.4_

---

- [x] 13. Checkpoint — backend complete
  - Ensure all backend unit and integration tests pass: `cd backend && npm test -- --run`
  - Ask the user if any backend behavior needs adjustment before proceeding to the frontend.

---

- [x] 14. React Dashboard — list view and simulate
  - [x] 14.1 Scaffold React app entry point and routing
    - Create `frontend/src/main.tsx` rendering `<App />` into `#root`
    - Create `frontend/src/App.tsx` with client-side routing (React Router or hash routing): `/` → `DiagnosisList`, `/diagnoses/:id` → `DiagnosisDetail`
    - Create `frontend/src/api.ts` with typed fetch helpers for all backend endpoints (`fetchDiagnoses`, `fetchDiagnosisById`, `postSimulate`)
    - _Requirements: 8.1, 8.3_

  - [x] 14.2 Implement `DiagnosisList` component with polling and simulate button
    - Poll `GET /diagnoses` every 3 seconds using `setInterval` / `useEffect`; on poll failure: retain current list and show a non-blocking toast or inline banner (do not clear the list)
    - Display a table/list of `DiagnosisSummary` rows: `repoName`, `jobName`, `commitSha` (truncated), `source`, `createdAt`, status badge, category badge
    - Status badge: `pending` (yellow), `complete` (green), `unavailable` (red)
    - Category badge: color-coded per category; show `"Uncategorized"` placeholder when `category` is null
    - Clicking a row navigates to `/diagnoses/:id`
    - "Simulate Failed Build" button opens a scenario dropdown (all 6 scenarios); on submit, POST to `/simulate` and display the new pending row within one polling cycle
    - _Requirements: 8.1, 8.2, 8.5, 8.7, 8.8, 8.10_

---

- [x] 15. React Detail View
  - [x] 15.1 Implement `DiagnosisDetail` component
    - Fetch `GET /diagnoses/:id` on mount; display: `repoName`, `jobName`, `commitSha`, `source`, `createdAt`, `completedAt`, `confidence`, status badge, category badge
    - Render `suggestedFix` using `react-markdown` (with syntax highlighting via `rehype-highlight` or similar)
    - Collapsible raw log section using `<details>`/`<summary>`; collapsed by default
    - When `status = "pending"`: show `"Diagnosis in progress…"` placeholder for `explanation`, `suggestedFix`, `confidence`, `category`
    - When `status = "unavailable"`: show `"Diagnosis could not be generated"` placeholder for those same fields
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.9_

---

- [x] 16. Build and deploy configuration
  - [x] 16.1 Add build scripts and deployment configuration
    - `backend/package.json`: `"build": "tsc"`, `"start": "node dist/server.js"`
    - `frontend/package.json`: `"build": "vite build"`, `"preview": "vite preview"`
    - Add `backend/Dockerfile` (optional) or deployment config notes in README
    - Verify `npm install && npm run build` succeeds in both workspaces with no TypeScript errors
    - _Requirements: 11.4_

---

- [x] 17. Final checkpoint
  - Run full test suite: `cd backend && npm test -- --run`
  - Verify frontend builds without errors: `cd frontend && npm run build`
  - Ensure all properties hold, all integration tests pass, and there are no TypeScript compilation errors.
  - Ask the user if questions arise before marking complete.

---

## Stretch Tasks

> Tasks below are optional and can be skipped for a faster MVP. All are marked with `*` at the sub-task level.

---

- [x] 18. Notification Service (stretch)
  - [x] 18.1 Implement `NotificationService`
    - Create `backend/src/services/notificationService.ts` implementing `notify(record: BuildRecord, result: DiagnosisResult): Promise<void>`
    - Extract first sentence of `result.explanation` as `explanationExcerpt`
    - Build `detailUrl` from `APP_BASE_URL` env var + `/diagnoses/` + `record.id`
    - If `SLACK_WEBHOOK_URL` is set and non-empty: POST `{ text: "[<category>] <excerpt> <url>" }` to that URL; catch any error, log it, continue
    - If `NOTIFICATION_EMAIL` is set and non-empty: send email via `nodemailer` with the same content; catch any error, log it, continue
    - Both channels run independently (Slack failure does not prevent email attempt); function always resolves, never rejects
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 18.2 Wire `notificationService` into `processJob`
    - In `jobQueue.ts`, import `notificationService` and call `notify()` fire-and-forget (wrapped in try/catch) after `status = "complete"` is persisted — before returning from `processJob`
    - _Requirements: 12.1, 12.3_

---

- [x] 19. Helpfulness Feedback (stretch)
  - [x] 19.1 Add `feedback` table DDL and data-access functions
    - Add `CREATE TABLE IF NOT EXISTS feedback` DDL to `db/init.ts` per design document schema (UUID PK, FK to `build_records`, `client_id`, `rating CHECK`, `UNIQUE(build_record_id, client_id)`)
    - Add indexes: `idx_feedback_build_record`, `idx_feedback_category`
    - Create `backend/src/db/feedback.ts` with `upsertFeedback(buildRecordId, clientId, rating)` (INSERT OR REPLACE) and `getFeedbackStats(): FailureCategoryStats[]` (returns all 7 categories with 0 defaults for missing ones)
    - _Requirements: 13.2, 13.3_

  - [x] 19.2 Implement `POST /diagnoses/:id/feedback` and `GET /feedback/stats` routes
    - `POST /diagnoses/:id/feedback`: validate `X-Client-Id` header is present and non-empty (400 if absent); validate `rating` is exactly `"helpful"` or `"unhelpful"` (400 with `{ error: "Invalid rating value" }` otherwise); call `upsertFeedback`; return 200 `FeedbackResponse`
    - `GET /feedback/stats`: call `getFeedbackStats()`; return `{ stats: FailureCategoryStats[] }` — all 7 categories always present with zero counts when no ratings exist
    - _Requirements: 13.2, 13.3, 13.4_

  - [x] 19.3 Implement thumbs-up/thumbs-down UI in `DiagnosisDetail`
    - On detail view mount, generate or retrieve `cicd-doctor-client-id` UUID from `localStorage` (generate once on first load and persist)
    - Fetch existing rating for this `buildRecordId` + `clientId` (via `GET /diagnoses/:id` — extend `DiagnosisDetail` response or add a separate fetch); show the matching button in a selected/highlighted state
    - On thumbs-up or thumbs-down click: POST to `/diagnoses/:id/feedback` with `{ rating }` and `X-Client-Id` header; update selected state optimistically
    - _Requirements: 13.1, 13.2_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints (tasks 13 and 17) ensure incremental validation at natural breaks
- Property tests (5.2) validate universal correctness properties of `truncateLog` using fast-check
- Unit tests validate specific examples and edge cases; integration tests validate full request/response cycles
- Stretch tasks (18–19) are self-contained and can be added without modifying any MVP code path

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "4.1"] },
    { "id": 4, "tasks": ["4.2", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 6, "tasks": ["6.2", "8.1"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["7.2", "9.1"] },
    { "id": 9, "tasks": ["9.2", "9.3"] },
    { "id": 10, "tasks": ["9.4", "10.1", "10.2"] },
    { "id": 11, "tasks": ["10.3", "11.1", "11.2"] },
    { "id": 12, "tasks": ["12.1"] },
    { "id": 13, "tasks": ["14.1"] },
    { "id": 14, "tasks": ["14.2"] },
    { "id": 15, "tasks": ["15.1"] },
    { "id": 16, "tasks": ["16.1"] },
    { "id": 17, "tasks": ["18.1"] },
    { "id": 18, "tasks": ["18.2", "19.1"] },
    { "id": 19, "tasks": ["19.2"] },
    { "id": 20, "tasks": ["19.3"] }
  ]
}
```
