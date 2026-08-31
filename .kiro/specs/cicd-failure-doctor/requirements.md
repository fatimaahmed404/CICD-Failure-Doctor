# Requirements Document

## Introduction

CI/CD Failure Doctor is a web application that automatically receives failed build logs from GitHub Actions or Jenkins via webhook, analyzes them using an LLM, and presents developers with a plain-English root-cause diagnosis and a concrete suggested fix. The system includes a first-class "Simulate Failed Build" path for demoing without a live CI connection, a React dashboard for viewing diagnoses, and graceful error handling when LLM analysis is unavailable.

## Glossary

- **System**: The complete CI/CD Failure Doctor application (backend + frontend)
- **Backend**: The Node.js/Express server handling webhooks, job processing, and database persistence
- **Webhook_Handler**: The Express route handler for `POST /webhook/ingest`
- **Simulate_Handler**: The Express route handler for `POST /simulate`
- **Job_Queue**: The in-process async queue that processes diagnosis jobs off the request path
- **Log_Processor**: The module responsible for cleaning and truncating raw build logs
- **LLM_Client**: The module that sends prompts to the LLM API and parses the structured JSON response
- **Diagnoses_API**: The Express routes serving `GET /diagnoses` and `GET /diagnoses/:id`
- **Dashboard**: The React frontend application
- **BuildRecord**: The persisted database record representing one build analysis job
- **DiagnosisResult**: The structured JSON object returned by the LLM containing category, explanation, suggestedFix, and confidence
- **FailureCategory**: One of the seven allowed failure classification strings
- **SimulationScenario**: One of the six pre-defined demo scenarios with bundled sample logs
- **WEBHOOK_SECRET**: The shared-secret environment variable used to authenticate incoming webhook requests
- **LLM_API_KEY**: The environment variable holding the LLM provider API key

---

## Requirements

### Requirement 1: Webhook Ingestion

**User Story:** As a CI system (GitHub Actions or Jenkins), I want to POST failed build logs and metadata to a webhook endpoint, so that the system automatically receives and queues them for AI diagnosis.

#### Acceptance Criteria

1. WHEN a POST request is received at `/webhook/ingest` with a valid `X-Webhook-Secret` header and all required fields (`log`, `repoName`, `jobName`, `commitSha`, `source`) present, non-empty, and non-whitespace-only, THE Webhook_Handler SHALL persist a BuildRecord with `status = "pending"` and return HTTP 202 with the record `id` and `status: "pending"`.
2. WHEN a POST request is received at `/webhook/ingest` with a missing or incorrect `X-Webhook-Secret` header, THE Webhook_Handler SHALL return HTTP 401 and not persist any BuildRecord.
3. WHEN a POST request is received at `/webhook/ingest` with one or more required fields (`log`, `repoName`, `jobName`, `commitSha`, `source`) absent, empty, or containing only whitespace characters, OR with a `commitSha` value that is not a 40-character or 64-character hexadecimal string, THE Webhook_Handler SHALL return HTTP 400 with a `details` array listing each offending field and not persist any BuildRecord.
4. WHEN a valid webhook request is processed, THE Webhook_Handler SHALL return the HTTP 202 response within 2 seconds without waiting for LLM analysis to complete.
5. THE Webhook_Handler SHALL validate the `X-Webhook-Secret` header using a constant-time comparison to prevent timing-based secret enumeration.
6. IF the total request payload size exceeds 10 MB, THEN THE Webhook_Handler SHALL return HTTP 413 and not persist any BuildRecord.
7. WHEN a POST request is received at `/webhook/ingest` with a `source` field whose value, compared case-sensitively, is not exactly `"github"` or `"jenkins"`, THE Webhook_Handler SHALL return HTTP 400 with a `details` array indicating the invalid `source` value and not persist any BuildRecord.

---

### Requirement 2: Simulate Failed Build

**User Story:** As a developer, I want to trigger a simulated failed build via the dashboard or API, so that I can demonstrate the full diagnosis workflow without a live CI integration.

#### Acceptance Criteria

1. WHEN a POST request is received at `/simulate` with a valid `scenario` field, THE Simulate_Handler SHALL load the corresponding bundled fixture log, persist a BuildRecord with `source = "simulate"` and `status = "pending"`, and return HTTP 202 with the record `id`, `scenario`, and `status: "pending"`.
2. IF a POST request is received at `/simulate` with a `scenario` value that is not one of the six supported scenarios, THEN THE Simulate_Handler SHALL return HTTP 400 with a `details` array indicating the invalid scenario value and not persist any BuildRecord.
3. WHEN no `scenario` field is provided in the simulate request, THE Simulate_Handler SHALL default to the `"test-failure"` scenario.
4. THE Simulate_Handler SHALL support exactly six scenarios: `"test-failure"`, `"dependency-error"`, `"docker-build-failure"`, `"env-var-missing"`, `"timeout"`, and `"lint-error"`.
5. WHEN a simulate request is processed, the resulting BuildRecord SHALL transition through the same `status` values (`"pending"` → `"complete"` or `"unavailable"`) and produce the same diagnosis output structure as a BuildRecord created via a real webhook request.
6. WHEN the "Simulate Failed Build" button is clicked on the Dashboard with a scenario selected, THE Dashboard SHALL submit a POST request to `/simulate` with the selected scenario and display the returned `id` and `status: "pending"` as a new row in the diagnosis list.
7. THE Dashboard SHALL provide a "Simulate Failed Build" button with a scenario selector dropdown containing all six scenarios: `"test-failure"`, `"dependency-error"`, `"docker-build-failure"`, `"env-var-missing"`, `"timeout"`, and `"lint-error"`.

---

### Requirement 3: Async Diagnosis Job Processing

**User Story:** As a developer, I want build logs to be analyzed asynchronously after ingestion, so that the webhook responds immediately and analysis proceeds in the background.

#### Acceptance Criteria

1. WHEN a BuildRecord with `status = "pending"` is enqueued, THE Job_Queue SHALL process it by calling Log_Processor to clean and truncate the raw log, then passing the cleaned log and record metadata to LLM_Client, and updating the record status to `"complete"` or `"unavailable"`.
2. WHEN Job_Queue processing completes successfully, THE Job_Queue SHALL update the BuildRecord with `status = "complete"`, all DiagnosisResult fields (`category`, `explanation`, `suggestedFix`, `confidence`) populated with non-null values, and `completedAt` set to the current UTC timestamp.
3. WHEN Job_Queue processing encounters a retryable error and the retry also fails, THE Job_Queue SHALL update the BuildRecord with `status = "unavailable"`, `completedAt` set to the current UTC timestamp, and `errorMessage` set to the error type and message string.
4. THE Job_Queue SHALL process jobs with a maximum concurrency of 2 simultaneous LLM calls.
5. THE Job_Queue SHALL ensure that for all BuildRecords that enter the queue, the record's `status` is set to either `"complete"` or `"unavailable"` within 120 seconds of being enqueued.

---

### Requirement 4: Log Processing and Truncation

**User Story:** As a system operator, I want raw build logs to be cleaned and intelligently truncated before LLM analysis, so that token costs are controlled and context limits are respected.

#### Acceptance Criteria

1. WHEN `truncateLog` is called with any string input, THE Log_Processor SHALL return a cleaned log string with all ANSI escape codes and terminal control sequences (including carriage returns `\r`, backspace `\b`, and bell `\a` characters) removed.
2. IF the raw log line count does not exceed `maxLines` (default 300), THEN THE Log_Processor SHALL return the full cleaned log with `truncated = false`.
3. IF the raw log line count exceeds `maxLines` (default 300), THEN THE Log_Processor SHALL return a truncated log with `truncated = true`, retaining the final `tailLines` (default 200) lines and up to `keywordLines` (default 100) lines whose text contains at least one of the keywords `error`, `fail`, `exception`, `fatal`, or `warning` as a case-insensitive substring match.
4. IF the log is truncated, THEN THE Log_Processor SHALL prepend a truncation notice of the form `[Log truncated: showing N of M lines]` to the cleaned log output, where M is the original line count and N is the count of unique retained lines after deduplication of keyword and tail line sets.
5. THE Log_Processor SHALL ensure the output line count of `truncateLog` does not exceed `maxLines + 1`, where the prepended truncation notice counts as one line.
6. IF the log is truncated and keyword-matching lines are collected, THEN THE Log_Processor SHALL deduplicate lines appearing in both the keyword set and the tail set, sort all keyword-only lines by original line number, and place them before the tail lines block in the final output.

---

### Requirement 5: LLM-Based Failure Diagnosis

**User Story:** As a developer, I want failed build logs analyzed by an LLM, so that I receive a plain-English root-cause explanation and a concrete suggested fix.

#### Acceptance Criteria

1. WHEN the LLM_Client receives a DiagnosisInput, THE LLM_Client SHALL include a system prompt instructing the LLM to return only a valid JSON object with fields `category`, `explanation`, `suggestedFix`, and `confidence` and no other text.
2. WHEN the LLM returns a valid JSON response, THE LLM_Client SHALL parse and validate it against the DiagnosisResult schema and return it to the caller.
3. WHEN the LLM returns a response that is not valid JSON, is missing required fields, or the LLM API call times out after 30 seconds or returns a network error, THE LLM_Client SHALL throw a typed `LLMParseError` or `NetworkError` respectively, with the raw response or error details attached.
4. THE LLM_Client SHALL classify each failure into exactly one of seven categories: `"dependency-build-error"`, `"test-failure"`, `"docker-build-failure"`, `"env-var-secrets"`, `"timeout-infrastructure"`, `"syntax-lint-error"`, or `"unknown"`.
5. THE LLM_Client SHALL assign a confidence level of `"high"`, `"medium"`, or `"low"` to each diagnosis.
6. THE LLM_Client SHALL produce an `explanation` field containing 2–5 sentences of plain-English root-cause description.
7. WHEN the `suggestedFix` references a specific file, command, or configuration key, THE LLM_Client SHALL include the corresponding corrected code or configuration snippet formatted as a fenced markdown code block.

---

### Requirement 6: LLM Error Handling and Retry

**User Story:** As a developer, I want the system to gracefully handle LLM failures, so that a temporary API error does not permanently block a diagnosis record.

#### Acceptance Criteria

1. WHEN the LLM_Client throws a `NetworkError` or timeout during an LLM call, THE Job_Queue SHALL maintain `status = "pending"` on the BuildRecord, wait 1 second, and retry the LLM call once.
2. WHEN the LLM_Client throws an `LLMParseError` (invalid JSON or missing fields), THE Job_Queue SHALL update the BuildRecord to `status = "unavailable"` with `errorMessage` set to the error type and message string and `completedAt` set to the current timestamp, without retrying.
3. THE Job_Queue SHALL ensure that for all BuildRecords with `status = "unavailable"`, the `explanation`, `category`, `suggested_fix`, and `confidence` fields are null and `error_message` is non-null.
4. THE Job_Queue SHALL call the LLM API at most 2 times per BuildRecord (initial attempt plus at most 1 retry for transient errors), resulting in `retry_count ≤ 1` on all records in a terminal state (`status = "complete"` or `status = "unavailable"`).
5. IF a BuildRecord has `status = "unavailable"`, THEN THE Dashboard SHALL display a "Diagnosis unavailable" badge for that record.

---

### Requirement 7: Diagnoses API

**User Story:** As a frontend application, I want REST endpoints to retrieve diagnosis records, so that the dashboard can display up-to-date results.

#### Acceptance Criteria

1. WHEN a GET request is received at `/diagnoses`, THE Diagnoses_API SHALL return a paginated list of DiagnosisSummary objects with `data`, `total`, `page`, and `pageSize` fields.
2. THE Diagnoses_API SHALL support `page` (default 1), `limit` (default 20, maximum 100), and `category` query parameters for filtering and pagination on `GET /diagnoses`.
3. WHEN a GET request is received at `/diagnoses/:id` for an existing record, THE Diagnoses_API SHALL return the full DiagnosisDetail including `suggestedFix`, `rawLog`, and `truncated` fields.
4. WHEN a GET request is received at `/diagnoses/:id` for a non-existent record, THE Diagnoses_API SHALL return HTTP 404.
5. IF no `page` or `limit` parameters are provided, THEN THE Diagnoses_API SHALL sort results by `createdAt` descending and return the first page with the default page size.
6. IF the `page` parameter refers to a page beyond the total number of records, THEN THE Diagnoses_API SHALL return HTTP 200 with an empty `data` array and the correct `total` count.
7. IF the `category` query parameter is provided with a value not in the set of valid FailureCategory values, THEN THE Diagnoses_API SHALL return HTTP 400.

---

### Requirement 8: React Dashboard

**User Story:** As a developer, I want a web dashboard showing recent CI/CD failure diagnoses, so that I can quickly understand what went wrong and how to fix it.

#### Acceptance Criteria

1. THE Dashboard SHALL poll `GET /diagnoses` every 3 seconds and update the displayed list with any new or changed records.
2. THE Dashboard SHALL display a status badge (`pending`, `complete`, or `unavailable`) for each record in the list view.
3. WHEN a user clicks a record row, THE Dashboard SHALL navigate to a detail view displaying the full explanation, suggested fix, and the record fields `repoName`, `jobName`, `commitSha`, `source`, `createdAt`, `completedAt`, and `confidence`.
4. THE Dashboard SHALL render the `suggestedFix` field as formatted Markdown, including syntax-highlighted code blocks.
5. THE Dashboard SHALL display the failure `category` as a color-coded badge in both list and detail views, showing an "Uncategorized" placeholder badge when `category` is null.
6. THE Dashboard SHALL provide a collapsible raw log section in the detail view, collapsed by default.
7. THE Dashboard SHALL display a "Simulate Failed Build" button with a scenario selector dropdown containing all six scenarios: `"test-failure"`, `"dependency-error"`, `"docker-build-failure"`, `"env-var-missing"`, `"timeout"`, and `"lint-error"`.
8. WHEN a simulate request is submitted, THE Dashboard SHALL display the new pending record in the list view within one polling cycle (≤ 3 seconds).
9. WHEN the detail view is opened for a record with `status = "pending"` or `status = "unavailable"`, THE Dashboard SHALL display placeholder text indicating the diagnosis is not yet available or could not be generated, rather than showing empty or null field values.
10. WHEN a poll request to `GET /diagnoses` fails, THE Dashboard SHALL retain the previously loaded records and display a non-blocking error indicator, without clearing the list.

---

### Requirement 9: Webhook Authentication

**User Story:** As a system operator, I want incoming webhooks to be authenticated via a shared secret, so that only authorized CI systems can submit build data.

#### Acceptance Criteria

1. THE Webhook_Handler SHALL read the shared secret exclusively from the `WEBHOOK_SECRET` environment variable.
2. THE Webhook_Handler SHALL NOT accept hardcoded secret values in source code or configuration files.
3. WHEN comparing the incoming `X-Webhook-Secret` header value to `WEBHOOK_SECRET`, THE Webhook_Handler SHALL use a comparison whose execution time does not vary based on the content or length of either value.
4. WHEN a POST request is received at `/webhook/ingest` with a missing `X-Webhook-Secret` header or with a value that does not match `WEBHOOK_SECRET`, THE Webhook_Handler SHALL return HTTP 401 with a response body that does not reveal whether the header was absent or incorrect.
5. WHEN `WEBHOOK_SECRET` is not set or is empty at runtime, THE Backend SHALL reject all incoming webhook requests with HTTP 500.

---

### Requirement 10: Data Persistence

**User Story:** As a system operator, I want all build records and diagnoses persisted in a database, so that history is available across server restarts.

#### Acceptance Criteria

1. WHEN a new BuildRecord is created, THE Backend SHALL persist it in a SQLite database using the `build_records` table schema defined in the design document.
2. WHEN a new BuildRecord is persisted, THE Backend SHALL generate a UUID v4 as the `id` field at insert time.
3. IF a BuildRecord insert is attempted with a `commitSha` value that is not a 40-character or 64-character hexadecimal string, THEN THE Backend SHALL reject the insert and return an error to the caller.
4. IF a BuildRecord insert is attempted with a `source` value that is not one of `"github"`, `"jenkins"`, or `"simulate"`, THEN THE Backend SHALL reject the insert and return an error to the caller.
5. THE Backend SHALL enforce that `status` is one of `"pending"`, `"complete"`, or `"unavailable"` via a database CHECK constraint.
6. WHEN a BuildRecord transitions from `status = "pending"` to `status = "complete"` or `status = "unavailable"`, THE Backend SHALL set `completedAt` to the current UTC timestamp at the time of that transition.
7. THE Backend SHALL maintain indexes on `status`, `created_at DESC`, and `category` columns, verifiable by the presence of those index definitions in the database schema.

---

### Requirement 11: Deployment and Environment

**User Story:** As a developer, I want the application deployable on free-tier cloud platforms without cloud-infrastructure dependencies, so that it is accessible immediately after a hackathon demo.

#### Acceptance Criteria

1. THE Backend SHALL require only `WEBHOOK_SECRET` and `LLM_API_KEY` as mandatory environment variables; all other configuration SHALL have working defaults.
2. IF either `WEBHOOK_SECRET` or `LLM_API_KEY` is not set at startup, THEN THE Backend SHALL log an error message identifying the missing variable and exit with a non-zero status code rather than starting in a degraded state.
3. THE Backend SHALL use SQLite as its database with no external database service dependency, storing the database file at a path configurable via a `DATABASE_PATH` environment variable that defaults to `./data/cicd-doctor.db`.
4. THE System SHALL be deployable to Render, Railway, or Vercel free tiers by running `npm install && npm run build` for the frontend and `node dist/server.js` for the backend, with no additional infrastructure provisioning steps.

---

### Requirement 12: Stretch — Notifications

**User Story:** As a developer, I want to receive Slack or email notifications when a diagnosis is complete, so that I am alerted without having to check the dashboard.

#### Acceptance Criteria

1. WHEN a BuildRecord transitions to `status = "complete"` and a `SLACK_WEBHOOK_URL` environment variable is set to a non-empty value, THE System SHALL send an HTTP POST to that URL containing the failure category, a one-sentence excerpt from the explanation, and the full URL to the diagnosis detail page constructed from the `APP_BASE_URL` environment variable and the record `id`.
2. WHEN a BuildRecord transitions to `status = "complete"` and a `NOTIFICATION_EMAIL` environment variable is set to a non-empty value, THE System SHALL send an email to that address containing the failure category, a one-sentence excerpt from the explanation, and the full URL to the diagnosis detail page.
3. WHEN a notification delivery attempt fails due to a network error or non-2xx HTTP response, THE System SHALL log the error message and continue operation without modifying the BuildRecord status or retrying the notification.

---

### Requirement 13: Stretch — Helpfulness Feedback

**User Story:** As a developer, I want to rate whether a diagnosis was helpful, so that the team can track LLM quality over time.

#### Acceptance Criteria

1. WHERE helpfulness feedback is enabled, WHEN a user opens a diagnosis detail view, THE Dashboard SHALL display a thumbs-up button and a thumbs-down button, with the button matching any previously submitted rating for that diagnosis shown in a selected state.
2. WHERE helpfulness feedback is enabled, WHEN a user submits a thumbs-up or thumbs-down rating for a diagnosis, THE Backend SHALL persist exactly one feedback record per diagnosis per user, associating the binary rating value and the corresponding BuildRecord identifier, and replace any prior rating from that user for the same diagnosis.
3. WHERE helpfulness feedback is enabled, WHEN helpfulness statistics are requested, THE Diagnoses_API SHALL return, for each failure category, the total count of helpful ratings and the total count of unhelpful ratings, returning zero for each count when no ratings exist for that category.
4. IF a user submits a rating with an invalid value (not thumbs-up or thumbs-down), THEN THE Backend SHALL reject the request and return an error response indicating the rating value is invalid, without persisting any data.
