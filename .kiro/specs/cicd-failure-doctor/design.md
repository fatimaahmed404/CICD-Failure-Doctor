# Design Document: CI/CD Failure Doctor

## Overview

CI/CD Failure Doctor is a web application that automatically receives failed build logs from GitHub Actions or Jenkins (via webhook), analyzes them using an LLM, and presents developers with a plain-English root-cause diagnosis and a concrete suggested fix — eliminating the need to manually scroll through noisy pipeline output.

The system is designed for hackathon-speed delivery: a Node.js/Express backend handles webhook ingestion and async LLM analysis, a React frontend provides a real-time diagnosis dashboard, and SQLite stores all build records. The entire stack is deployable on free-tier platforms (Render, Railway, Vercel) with no cloud-infrastructure dependency. A first-class "Simulate Failed Build" path ensures the app is fully demoable without a live CI connection.

The MVP prioritizes a reliable, end-to-end demoable workflow. Stretch features (Slack/email notifications, helpfulness feedback) are isolated and clearly separated so they can be added without touching core paths.

---

## Architecture

```mermaid
graph TD
    subgraph Clients
        GH[GitHub Actions Webhook]
        JK[Jenkins Webhook]
        UI[React Dashboard]
    end

    subgraph Backend["Backend (Node.js / Express)"]
        WH[POST /webhook/ingest]
        SIM[POST /simulate]
        DIAG[GET /diagnoses]
        DETAIL[GET /diagnoses/:id]
        QUEUE[Async Job Queue]
        LLM[LLM Client]
        LOG[Log Processor]
        DB[(SQLite Database)]
        NOTIF[Notification Service - stretch]
        FB[POST /diagnoses/:id/feedback - stretch]
        FBSTATS[GET /feedback/stats - stretch]
        AUTOFIX[AutoFixService - stretch]
        SIMSERV[SimilarityService - stretch]
        FLAKY[FlakinessTracker - stretch]
    GHCONN[GET /auth/github/login - stretch]
    GHCB[GET /auth/github/callback - stretch]
    GHREPOS[GET /github/repos - stretch]
    GHCONNREPO[POST /github/connect-repo - stretch]
    CFG[GET /config - stretch]
    end

    subgraph External["External - stretch"]
        SLK[Slack Webhook URL]
        EMAIL[Email - SMTP]
        GHAPI[GitHub API]
    end

    GH -->|POST + X-Secret header| WH
    JK -->|POST + X-Secret header| WH
    UI -->|Click Simulate| SIM
    UI -->|Poll / load| DIAG
    UI -->|Click row| DETAIL

    WH -->|Validate + persist| DB
    WH -->|Enqueue job| QUEUE
    SIM -->|Persist + enqueue| QUEUE
    QUEUE -->|Clean + truncate log| LOG
    LOG -->|Prompt| LLM
    LLM -->|Structured JSON| QUEUE
    QUEUE -->|Update record| DB
    DIAG -->|Query| DB
    DETAIL -->|Query| DB

    %% stretch edges - notifications
    QUEUE -->|on complete, fire-and-forget - stretch| NOTIF
    NOTIF -->|HTTP POST - stretch| SLK
    NOTIF -->|SMTP - stretch| EMAIL
    
    %% stretch edges - feedback
    UI -->|Submit rating - stretch| FB
    UI -->|Load stats - stretch| FBSTATS
    FB -->|Upsert - stretch| DB
    FBSTATS -->|Query feedback table - stretch| DB
    
    %% stretch edges - auto-fix
    QUEUE -->|on complete, parallel - stretch| AUTOFIX
    AUTOFIX -->|Create branch + PR - stretch| GHAPI
    AUTOFIX -->|Update auto_fix_pr_url - stretch| DB
    
    %% stretch edges - similarity
    QUEUE -->|on complete, parallel - stretch| SIMSERV
    SIMSERV -->|Generate embedding - stretch| LLM
    SIMSERV -->|Find similar + update - stretch| DB
    
    %% stretch edges - flakiness
    QUEUE -->|on complete, parallel - stretch| FLAKY
    FLAKY -->|Query recent builds - stretch| DB
    FLAKY -->|Update flaky_tests - stretch| DB

    %% stretch edges - github oauth
    UI -->|GET /config - stretch| CFG
    UI -->|Connect GitHub - stretch| GHCONN
    GHCONN -->|302 redirect - stretch| GHAPI
    GHCB -->|Exchange code + store token - stretch| DB
    GHREPOS -->|Decrypt token + list repos - stretch| GHAPI
    GHCONNREPO -->|Create secrets + workflow - stretch| GHAPI
    GHCONNREPO -->|Read/write token - stretch| DB
```

---

## Sequence Diagrams

### Webhook Ingestion Flow

```mermaid
sequenceDiagram
    participant CI as CI System (GH/Jenkins)
    participant API as Express API
    participant DB as SQLite
    participant Q as Job Queue
    participant LP as Log Processor
    participant LLM as LLM API

    CI->>API: POST /webhook/ingest (log + metadata + X-Secret)
    API->>API: Validate shared secret
    alt Secret invalid
        API-->>CI: 401 Unauthorized
    else Secret valid
        API->>DB: INSERT build_record (status=pending)
        API-->>CI: 202 Accepted { id }
        API->>Q: enqueue(buildRecordId)
        Q->>DB: SELECT build_record
        Q->>LP: truncateLog(rawLog)
        LP-->>Q: cleanedLog
        Q->>LLM: POST /chat/completions (prompt + cleanedLog)
        alt LLM success
            LLM-->>Q: { category, explanation, fix, confidence }
            Q->>DB: UPDATE build_record (status=complete, diagnosis)
        else LLM error / invalid JSON
            Q->>LLM: retry once
            alt Retry success
                LLM-->>Q: valid response
                Q->>DB: UPDATE build_record (status=complete)
            else Retry fails
                Q->>DB: UPDATE build_record (status=unavailable)
            end
        end
    end
```

### Simulate Build Flow

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant API as Express API
    participant DB as SQLite
    participant Q as Job Queue
    participant LLM as LLM API

    U->>API: POST /simulate { scenario }
    API->>API: Load bundled sample log for scenario
    API->>DB: INSERT build_record (source=simulate, status=pending)
    API-->>U: 202 Accepted { id }
    API->>Q: enqueue(buildRecordId)
    Q->>LLM: analyze log
    LLM-->>Q: diagnosis JSON
    Q->>DB: UPDATE build_record (status=complete)
    U->>API: GET /diagnoses (poll)
    API-->>U: updated record list with new diagnosis
```

### Dashboard Load Flow

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant API as Express API
    participant DB as SQLite

    U->>API: GET /diagnoses?page=1&limit=20
    API->>DB: SELECT with pagination
    DB-->>API: rows[]
    API-->>U: 200 { data: DiagnosisSummary[], total, page }
    U->>API: GET /diagnoses/:id
    API->>DB: SELECT by id
    DB-->>API: full record
    API-->>U: 200 DiagnosisDetail
```

### GitHub OAuth Connection Flow (stretch)

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant API as Express API
    participant DB as SQLite
    participant GH as GitHub OAuth
    participant GHAPI as GitHub API

    U->>API: GET /config
    API-->>U: { features: { githubOAuth: true } }
    U->>API: GET /auth/github/login
    API->>API: Generate state parameter
    API-->>U: 302 Redirect to GitHub OAuth
    U->>GH: Authorize app (scope=repo)
    GH-->>U: Redirect to /auth/github/callback?code=...&state=...
    U->>API: GET /auth/github/callback?code=...&state=...
    API->>API: Validate state
    API->>GH: POST /oauth/access_token (exchange code)
    GH-->>API: { access_token }
    API->>API: Encrypt token
    API->>DB: INSERT github_tokens (client_id, encrypted_token)
    API->>GHAPI: GET /user (fetch username)
    GHAPI-->>API: { login: "username" }
    API->>DB: UPDATE github_tokens SET github_username
    API-->>U: 200 { success: true, username }
    U->>API: GET /github/repos (Header: X-Client-Id)
    API->>DB: SELECT encrypted_token WHERE client_id
    API->>API: Decrypt token
    API->>GHAPI: GET /user/repos (Bearer token)
    GHAPI-->>API: [{ name, full_name, default_branch, ... }]
    API-->>U: { repos: [...] }
    U->>API: POST /github/connect-repo { repoFullName } (Header: X-Client-Id)
    API->>DB: SELECT encrypted_token
    API->>API: Decrypt token
    API->>GHAPI: GET /repos/{owner}/{repo}/actions/secrets/public-key
    GHAPI-->>API: { key, key_id }
    API->>API: Encrypt WEBHOOK_SECRET with public key
    API->>GHAPI: PUT /repos/{owner}/{repo}/actions/secrets/CICD_DOCTOR_SECRET
    API->>GHAPI: PUT /repos/{owner}/{repo}/actions/secrets/CICD_DOCTOR_URL
    API->>GHAPI: PUT /repos/{owner}/{repo}/contents/.github/workflows/cicd-failure-doctor.yml
    GHAPI-->>API: { content: { html_url } }
    API-->>U: 200 { success: true, workflowUrl }
```

---

## Components and Interfaces

### Component 1: Webhook Ingestion Handler

**Purpose**: Receives POST requests from GitHub Actions or Jenkins, validates the shared-secret header, persists a pending build record, and enqueues the record for async analysis. Responds within ~200 ms.

**Interface**:
```typescript
// POST /webhook/ingest
interface WebhookPayload {
  log: string;               // raw build log text
  repoName: string;          // e.g. "org/my-repo"
  jobName: string;           // workflow/job name
  commitSha: string;         // 40-char hex
  source: "github" | "jenkins";
  branch?: string;
}

interface WebhookResponse {
  id: string;                // UUID of the created build record
  status: "pending";
}
```

**Responsibilities**:
- Validate `X-Webhook-Secret` header against `WEBHOOK_SECRET` env var
- Reject payloads missing required fields (400)
- Reject requests whose total payload exceeds 10 MB — Express body parser is configured with a 10 MB limit; the handler returns HTTP 413 with body `{ error: "Payload too large" }` (Req 1.6)
- Persist a `BuildRecord` with `status = "pending"`
- Enqueue async diagnosis job and return 202 immediately
- Never wait for LLM result before responding

---

### Component 2: Simulate Build Handler

**Purpose**: Provides a first-class demo path. Accepts an optional scenario name, loads a bundled sample log, and runs it through the same ingestion + diagnosis pipeline as a real webhook.

**Interface**:
```typescript
// POST /simulate
interface SimulateRequest {
  scenario?: SimulationScenario;  // defaults to "test-failure"
}

type SimulationScenario =
  | "test-failure"
  | "dependency-error"
  | "docker-build-failure"
  | "env-var-missing"
  | "timeout"
  | "lint-error";

interface SimulateResponse {
  id: string;
  scenario: SimulationScenario;
  status: "pending";
}
```

**Responsibilities**:
- Map scenario to a bundled sample log file in `/fixtures/`
- Inject synthetic metadata (repo name, job name, commit SHA)
- Call the same `ingestBuild()` service function used by the real webhook
- Return 202 with record ID so the UI can poll for results

---

### Component 3: Async Job Queue

**Purpose**: Processes build records off the request path. Pulls pending records, runs log processing, calls the LLM, and updates the database record with the diagnosis or an unavailable state.

**Interface**:
```typescript
interface DiagnosisJob {
  buildRecordId: string;
}

interface JobProcessor {
  enqueue(job: DiagnosisJob): void;
  process(job: DiagnosisJob): Promise<void>;
}
```

**Responsibilities**:
- Maintain an in-process queue (using `p-queue` or a simple async FIFO for MVP)
- Fetch the full `BuildRecord` from the database
- Pass raw log to `LogProcessor.truncate()`
- Call `LLMClient.diagnose()` with the cleaned log + metadata
- On success: update record to `status = "complete"` with diagnosis fields
- After a successful update to `"complete"`: fire-and-forget call to `NotificationService.notify(record, diagnosisResult)` — this call is NOT awaited in a way that blocks or affects `BuildRecord.status`; if `notify()` throws, the error is caught and logged and the `BuildRecord` is unaffected (Req 12.3)
- On LLM error: retry once with exponential backoff
- On second failure: update record to `status = "unavailable"`
- Enforce a 120-second SLA per job: if `processJob` has not reached a terminal status within 120 seconds of being dequeued, a watchdog mechanism forces the record to `status = "unavailable"` with `errorMessage = "Diagnosis SLA timeout: exceeded 120 s"` and `completedAt = now()` (Req 3.5)
- Emit status updates so SSE/polling endpoints reflect current state

---

### Component 4: Log Processor

**Purpose**: Cleans and intelligently truncates raw build logs before sending to the LLM, controlling token cost and staying within context limits.

**Interface**:
```typescript
interface LogProcessor {
  truncate(rawLog: string, options?: TruncateOptions): string;
}

interface TruncateOptions {
  maxLines?: number;          // default 300
  tailLines?: number;         // default 200 — always keep last N lines
  keywordLines?: number;      // default 100 — lines matching error keywords
  keywords?: string[];        // default: ["error", "fail", "exception", "fatal", "warning"]
}

interface TruncateResult {
  cleanedLog: string;
  originalLineCount: number;
  truncated: boolean;
}
```

**Responsibilities**:
- Strip ANSI escape codes and terminal control sequences
- Always retain the final `tailLines` lines (most recent output)
- Collect up to `keywordLines` additional lines that match error keywords
- Deduplicate and sort collected lines by original line number
- Prefix output with a truncation notice when log was shortened
- Return result within a synchronous call (no I/O)

---

### Component 5: LLM Client

**Purpose**: Sends a structured prompt to the configured LLM API and parses the JSON diagnosis response.

**Interface**:
```typescript
interface LLMClient {
  diagnose(input: DiagnosisInput): Promise<DiagnosisResult>;
}

interface DiagnosisInput {
  cleanedLog: string;
  repoName: string;
  jobName: string;
  source: "github" | "jenkins" | "simulate";
}

interface DiagnosisResult {
  category: FailureCategory;
  explanation: string;       // plain-English, 2–5 sentences
  suggestedFix: string;      // markdown — may include code/config snippet
  confidence: "high" | "medium" | "low";
}

type FailureCategory =
  | "dependency-build-error"
  | "test-failure"
  | "docker-build-failure"
  | "env-var-secrets"
  | "timeout-infrastructure"
  | "syntax-lint-error"
  | "unknown";
```

**Responsibilities**:
- Construct a system prompt that instructs the LLM to return only valid JSON
- Inject `cleanedLog` and metadata into the user message
- Parse and validate the response against the `DiagnosisResult` schema
- Throw a typed `LLMParseError` when response is not valid JSON or missing required fields
- Let the caller (Job Queue) handle retry logic

---

### Component 6: Diagnoses API

**Purpose**: Serves the React dashboard with paginated lists and full detail records.

**Interface**:
```typescript
// GET /diagnoses?page=1&limit=20&category=test-failure
interface DiagnosisListResponse {
  data: DiagnosisSummary[];
  total: number;
  page: number;
  pageSize: number;
}

interface DiagnosisSummary {
  id: string;
  repoName: string;
  jobName: string;
  commitSha: string;
  source: "github" | "jenkins" | "simulate";
  status: BuildStatus;
  category: FailureCategory | null;
  explanation: string | null;   // first sentence only
  confidence: string | null;
  createdAt: string;            // ISO 8601
  completedAt: string | null;
}

// GET /diagnoses/:id
interface DiagnosisDetail extends DiagnosisSummary {
  suggestedFix: string | null;  // full markdown
  rawLog: string;
  truncated: boolean;
}

type BuildStatus = "pending" | "complete" | "unavailable";
```

**Responsibilities**:
- Serve paginated `DiagnosisSummary` lists via `GET /diagnoses` with `page`, `limit` (default 20, max 100), and `category` filter params
- Sort results by `createdAt` descending by default
- If `page` refers to a page beyond the total record count, return HTTP 200 with an empty `data` array and the correct `total` (not an error) (Req 7.6)
- If `category` is provided with a value outside the valid `FailureCategory` set, return HTTP 400 (Req 7.7)
- Serve full `DiagnosisDetail` (including `suggestedFix`, `rawLog`, `truncated`) via `GET /diagnoses/:id`; return HTTP 404 for unknown IDs

---

### Component 7: React Dashboard

**Purpose**: Displays the list of recent diagnoses, provides the Simulate button, and shows full detail views.

**Responsibilities**:
- Poll `GET /diagnoses` every 3 seconds to surface new results
- Show status badge (pending / complete / unavailable) per row
- Render `Simulate Failed Build` button with scenario selector dropdown
- Navigate to detail view on row click
- Render `suggestedFix` as formatted Markdown (using `react-markdown`)
- Display collapsible raw log section in detail view
- Show failure category as a color-coded badge
- When the detail view is opened for a record with `status = "pending"` or `status = "unavailable"`, display clear placeholder text (e.g. "Diagnosis in progress…" or "Diagnosis could not be generated") instead of blank or null field values (Req 8.9)
- When a `GET /diagnoses` poll request fails (network error or non-2xx), retain the currently displayed list and show a small non-blocking error indicator (e.g. a toast or inline banner); do not clear the list or crash (Req 8.10)

---

### Component 8: Notification Service (stretch)

> **Stretch Feature**: Only active when `SLACK_WEBHOOK_URL` or `NOTIFICATION_EMAIL` environment variables are set.

**Purpose**: Sends Slack and/or email notifications when a BuildRecord transitions to `status = "complete"`. Runs in parallel with the job queue response and never blocks it.

**Interface**:
```typescript
interface NotificationService {
  notify(record: BuildRecord, result: DiagnosisResult): Promise<void>;
}

interface NotificationPayload {
  category: FailureCategory;
  explanationExcerpt: string;   // first sentence of explanation
  detailUrl: string;            // APP_BASE_URL + "/diagnoses/" + record.id
}
```

**Responsibilities**:
- Extract first sentence of `explanation` as `explanationExcerpt`
- Build `detailUrl` from `APP_BASE_URL` env var + `/diagnoses/` + `record.id`
- IF `SLACK_WEBHOOK_URL` is set and non-empty: POST `{ text: "..." }` to that URL with the category, excerpt, and link
- IF `NOTIFICATION_EMAIL` is set and non-empty: send email with the same content via `nodemailer`
- On network error or non-2xx response from either channel: log the error and return — do NOT retry, do NOT throw (Req 12.3)
- Both channels run independently; failure of one does not prevent the other

---

### Component 9: Helpfulness Feedback (stretch)

> **Stretch Feature**: Provides anonymous per-diagnosis ratings. Requires no authentication; client identity is a UUID generated and persisted in browser `localStorage`.

**Purpose**: Allows users to rate diagnoses as helpful or unhelpful. Uses an anonymous client-generated identifier since the app has no authentication system.

> **Design Decision — Anonymous Client Identity**: The application has no user authentication anywhere in the spec. Requirement 13.2 calls for "one feedback record per diagnosis per user". This is implemented using a random UUID generated by the Dashboard on first load and persisted in `localStorage` as `cicd-doctor-client-id`. This UUID is sent as an `X-Client-Id` header on all feedback requests. This approach provides session-level deduplication without requiring login. It is not cryptographically secure — a user can reset their ID by clearing localStorage — but is sufficient for the hackathon use case.

**Interface**:
```typescript
// POST /diagnoses/:id/feedback
interface FeedbackRequest {
  rating: "helpful" | "unhelpful";
}
// Header: X-Client-Id: <uuid>

interface FeedbackResponse {
  id: string;           // feedback record UUID
  buildRecordId: string;
  clientId: string;
  rating: "helpful" | "unhelpful";
  createdAt: string;    // ISO 8601
}

// GET /feedback/stats
interface FeedbackStatsResponse {
  stats: FailureCategoryStats[];
}

interface FailureCategoryStats {
  category: FailureCategory;
  helpful: number;
  unhelpful: number;
}
```

**Responsibilities**:
- `POST /diagnoses/:id/feedback`: validate `rating` is exactly `"helpful"` or `"unhelpful"`; reject any other value with HTTP 400 and a clear error message (Req 13.4); validate `X-Client-Id` header is present and non-empty (HTTP 400 if absent); upsert into `feedback` table keyed on `(build_record_id, client_id)`, replacing any prior rating from that client for that diagnosis (Req 13.2)
- `GET /feedback/stats`: return counts per `FailureCategory`; return `{ helpful: 0, unhelpful: 0 }` for categories with no ratings (Req 13.3)
- Dashboard: on detail view open, fetch existing rating for the current `clientId` and show the matching button as selected (Req 13.1)

---

### Component 10: AutoFixService (stretch)

> **Stretch Feature**: Automatically creates GitHub pull requests with suggested fixes for mechanically fixable failures. Only active when `GITHUB_TOKEN` and `GITHUB_REPO` environment variables are set.

**Purpose**: Opens a GitHub PR with the LLM-generated fix when the diagnosis is high-confidence and mechanically applicable, allowing developers to apply fixes with one click rather than manual file editing.

**Interface**:
```typescript
interface AutoFixService {
  createFix(record: BuildRecord, result: ExtendedDiagnosisResult): Promise<string | null>;
}

interface ExtendedDiagnosisResult extends DiagnosisResult {
  autoFixable: boolean;
  autoFixFile?: {
    path: string;      // relative file path in repo, e.g., "package.json"
    content: string;   // complete file content after fix
  };
}

interface AutoFixResult {
  prUrl: string;       // GitHub PR URL
  branch: string;      // created branch name
}
```

**Responsibilities**:
- Check that `GITHUB_TOKEN` and `GITHUB_REPO` are both set and non-empty; if either is missing, return `null` immediately without error (Req 14.5)
- Only proceed when `result.category ∈ {"dependency-build-error", "docker-build-failure"}` AND `result.confidence = "high"` AND `result.autoFixable = true` AND `result.autoFixFile` is populated with non-empty `path` and `content` (Req 14.1)
- Create a new branch named `cicd-doctor-fix/{record.id}` from the repository's default branch via GitHub API (Req 14.1)
- Commit the file at `autoFixFile.path` with content `autoFixFile.content` to the new branch with commit message `"Auto-fix: {category} diagnosed in {jobName}"` (Req 14.1)
- Open a pull request targeting the default branch with title `"Auto-fix: {category} in {jobName}"` and body containing the diagnosis `explanation` and a link to the diagnosis detail page constructed from `APP_BASE_URL` and `record.id` (Req 14.2)
- Return the PR URL from the GitHub API response (Req 14.3)
- On any error (network, GitHub API 4xx/5xx, insufficient permissions, branch already exists): catch, log error with full context, return `null` (Req 14.6)
- Never throw exceptions — all errors are caught internally and result in `null` return

---

### Component 11: SimilarityService (stretch)

> **Stretch Feature**: Generates embedding vectors for build logs and identifies similar past failures using cosine similarity. Uses the existing LLM provider's embeddings endpoint with no external vector database.

**Purpose**: Helps developers learn from past solutions by surfacing previously diagnosed similar failures, reducing redundant investigation time for recurring issues.

**Interface**:
```typescript
interface SimilarityService {
  generateEmbedding(cleanedLog: string): Promise<number[] | null>;
  findSimilar(embedding: number[], currentRecordId: string): Promise<SimilarMatch | null>;
}

interface SimilarMatch {
  buildRecordId: string;
  similarityScore: number;  // 0.0 to 1.0
}
```

**Responsibilities**:
- Call the LLM provider's embeddings API endpoint (e.g., OpenAI `/v1/embeddings` or compatible) using `LLM_API_KEY` with the `cleanedLog` as input (Req 15.1)
- Parse the response and extract the embedding vector as an array of floating-point numbers (Req 15.1)
- On success: return the embedding array; on error (network, API error, timeout, invalid response): catch, log, return `null` (Req 15.7)
- Query the `build_records` table for all records with `status = "complete"` and non-null `embedding` column, excluding the current record (Req 15.3)
- For each prior record, deserialize the `embedding` JSON and compute cosine similarity: `dot(a, b) / (||a|| * ||b||)` using in-process calculation (Req 15.3)
- Identify the single most similar record with similarity > 0.85; if none exceed threshold, return `null` (Req 15.4)
- Return `{ buildRecordId, similarityScore }` for the most similar match (Req 15.4)
- Complete all operations (embedding + similarity search) within the existing 120-second diagnosis SLA (Req 15.6)
- Never use external vector database services; all storage uses SQLite `build_records.embedding` TEXT column storing JSON-serialized float arrays (Req 15.8)

---

### Component 12: FlakinessTracker (stretch)

> **Stretch Feature**: Detects intermittently failing tests by analyzing failure patterns across recent builds within the same repository.

**Purpose**: Distinguishes new regressions from pre-existing flaky tests, helping developers prioritize investigation effort and avoid false alarms.

**Interface**:
```typescript
interface FlakinessTracker {
  checkFlaky(record: BuildRecord): Promise<FlakyTest[] | null>;
}

interface FlakyTest {
  testName: string;
  failureRate: string;  // e.g., "4/10"
}
```

**Responsibilities**:
- Only proceed when `record.category = "test-failure"` and `record.failing_tests` is a non-empty array (Req 16.1)
- Query the `build_records` table for the 10 most recent records with `repo_name = record.repo_name` and `category = "test-failure"`, ordered by `created_at DESC`, using the index on `(repo_name, category, created_at)` (Req 16.2, 16.7)
- Deserialize each record's `failing_tests` JSON array (Req 16.3)
- For each test name in the current record's `failing_tests`, count how many of the 10 retrieved records (including current) contain that test name (Req 16.3)
- If a test appears in ≥ 3 of the 10 builds, mark as flaky with `failureRate` formatted as `"{count}/10"` (Req 16.4)
- Return array of `FlakyTest` objects for all flaky tests; return empty array if none are flaky; return `null` on error (Req 16.4)
- On any error (database query failure, missing `failing_tests` in prior records, computation error): catch, log, return `null` (Req 16.8)
- Never analyze across repositories — only within same `repo_name` (Req 16.6)

---

### Component 13: GitHubConnectionService (stretch)

> **OPTIONAL STRETCH FEATURE**: This is a significantly larger addition than prior stretch features. It provides a convenience layer on top of the existing manual webhook setup — the manual method (documented in CI Trigger Snippets) remains the primary, always-available integration path. If `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` environment variables are unset, this entire feature is hidden and has zero impact on existing functionality.

**Purpose**: Enables users to connect their GitHub account via OAuth and automatically configure a selected repository with the required webhook secret and workflow file, eliminating the need for manual secret and workflow file creation in GitHub's UI.

**Interface**:
```typescript
// GET /config
interface AppConfigResponse {
  features: {
    githubOAuth: boolean;  // true if GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set
  };
}

// GET /auth/github/login
// Redirects to GitHub OAuth authorize URL with 302

// GET /auth/github/callback?code=...&state=...
interface GitHubCallbackResponse {
  success: boolean;
  username: string | null;  // GitHub username if available
}

// GET /github/repos
// Header: X-Client-Id: <uuid>
interface GitHubRepo {
  name: string;             // e.g., "my-repo"
  full_name: string;        // e.g., "owner/my-repo"
  default_branch: string;   // e.g., "main"
  html_url: string;         // GitHub web URL
}

interface GitHubReposResponse {
  repos: GitHubRepo[];
}

// POST /github/connect-repo
// Header: X-Client-Id: <uuid>
interface ConnectRepoRequest {
  repoFullName: string;  // e.g., "owner/my-repo"
}

interface ConnectRepoResponse {
  success: boolean;
  repoFullName: string;
  workflowUrl: string;   // GitHub web URL to the created workflow file
}

// DELETE /github/disconnect
// Header: X-Client-Id: <uuid>
interface DisconnectResponse {
  success: boolean;
}
```

**Responsibilities**:
- `GET /config`: return `{ features: { githubOAuth: true } }` if both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set and non-empty; otherwise return `{ features: { githubOAuth: false } }` (Req 17.1, 17.2)
- `GET /auth/github/login`: generate a random `state` parameter, store it in the user's session (using `express-session` or equivalent), construct the GitHub OAuth authorization URL `https://github.com/login/oauth/authorize?client_id={GITHUB_CLIENT_ID}&scope=repo&redirect_uri={GITHUB_REDIRECT_URI}&state={state}`, and redirect with HTTP 302 (Req 17.3)
- `GET /auth/github/callback`: validate `state` parameter matches the stored session value (return HTTP 400 if mismatch); exchange the `code` for an access token by POST to `https://github.com/login/oauth/access_token` with `client_id`, `client_secret`, `code`, and `redirect_uri`; parse the access token from the response; encrypt the token using AES-256-GCM with a key derived from `TOKEN_ENCRYPTION_KEY` via `crypto.scrypt`; persist the encrypted token in the `github_tokens` table keyed by the `X-Client-Id` header value; call `GET https://api.github.com/user` to retrieve the GitHub username and store it in the `github_username` column (best-effort; if this fails, leave username null); return HTTP 200 with `{ success: true, username }` and redirect the user to the dashboard (Req 17.4, 17.5, 17.19)
- `GET /github/repos`: retrieve the encrypted token for the `X-Client-Id` from the `github_tokens` table; decrypt it; call `GET https://api.github.com/user/repos?affiliation=owner,collaborator&sort=updated&per_page=100` with `Authorization: Bearer {token}`; parse the response and filter for repositories where the user has push access (check `permissions.push = true`); return `{ repos: [...] }` with `name`, `full_name`, `default_branch`, `html_url` for each (Req 17.6)
- `POST /github/connect-repo`: retrieve and decrypt the OAuth token for the `X-Client-Id`; parse `repoFullName` into `owner` and `repo` components; call `GET https://api.github.com/repos/{owner}/{repo}/actions/secrets/public-key` to fetch the repository's public key; encrypt `WEBHOOK_SECRET` using `libsodium-wrappers` sealed box encryption with the fetched public key; create/update the repository secret `CICD_DOCTOR_SECRET` via `PUT https://api.github.com/repos/{owner}/{repo}/actions/secrets/CICD_DOCTOR_SECRET` with the encrypted value; create/update the repository secret `CICD_DOCTOR_URL` via `PUT https://api.github.com/repos/{owner}/{repo}/actions/secrets/CICD_DOCTOR_URL` with `APP_BASE_URL`; construct a workflow file content (same as documented in CI Trigger Snippets, adapted to reference the two secrets); call `PUT https://api.github.com/repos/{owner}/{repo}/contents/.github/workflows/cicd-failure-doctor.yml` with the workflow content and a commit message `"Add CI/CD Failure Doctor workflow"`; return HTTP 200 with `{ success: true, repoFullName, workflowUrl }` (Req 17.8)
- If secret creation succeeds but workflow file creation fails: return HTTP 207 (Multi-Status) with a response indicating which step failed and a link to manual setup instructions (Req 17.9)
- If secret creation fails: return HTTP 400 or HTTP 403 with a clear error message; do not proceed to workflow file creation (Req 17.10)
- If GitHub API returns HTTP 401/403 for a token-authenticated request: return HTTP 401 to the client with a message indicating the token is invalid and the user must reconnect (Req 17.7)
- If GitHub API returns HTTP 403 with `X-RateLimit-Remaining: 0`: return HTTP 429 with the `X-RateLimit-Reset` timestamp from the GitHub response (Req 17.15)
- `DELETE /github/disconnect`: delete the `github_tokens` record for the `X-Client-Id`; return `{ success: true }` (Req 17.20)
- If `TOKEN_ENCRYPTION_KEY` is not set at startup: generate a random 32-byte key, log a warning that tokens will not persist across restarts, and use the in-memory key (Req 17.17)
- Dashboard: on load, call `GET /config`; if `githubOAuth: true`, render the "Connect GitHub" button; on button click, navigate to `/auth/github/login`; after OAuth callback, fetch and display repos from `GET /github/repos`; on "Connect this repo" button click, call `POST /github/connect-repo` and display a confirmation with the workflow file link; render the GitHub username and a "Disconnect" button if connected (Req 17.11, 17.12, 17.13, 17.20)
- Never use the GitHub App installation model — this feature uses standard OAuth App with user access tokens only (Req 17.16)
- Never modify or delete any existing file, secret, or workflow in the target repository other than `CICD_DOCTOR_SECRET`, `CICD_DOCTOR_URL`, and `.github/workflows/cicd-failure-doctor.yml` (Req 17.14)

---

## Data Models

### BuildRecord

```typescript
interface BuildRecord {
  id: string;                    // UUID v4
  repoName: string;
  jobName: string;
  commitSha: string;
  branch: string | null;
  source: "github" | "jenkins" | "simulate";
  rawLog: string;
  cleanedLog: string | null;
  truncated: boolean;
  status: BuildStatus;
  category: FailureCategory | null;
  explanation: string | null;
  suggestedFix: string | null;
  confidence: "high" | "medium" | "low" | null;
  retryCount: number;            // 0 or 1
  errorMessage: string | null;   // internal error if status=unavailable
  createdAt: Date;
  completedAt: Date | null;
  autoFixPrUrl: string | null;   // GitHub PR URL if auto-fix created (stretch)
  embedding: number[] | null;    // Embedding vector for similarity search (stretch)
  similarTo: SimilarMatch | null; // Most similar prior failure (stretch)
  failingTests: string[] | null; // Extracted test names for test-failure category (stretch)
  flakyTests: FlakyTest[] | null; // Detected flaky tests (stretch)
}
```

**SQLite DDL**:
```sql
CREATE TABLE build_records (
  id           TEXT PRIMARY KEY,
  repo_name    TEXT NOT NULL,
  job_name     TEXT NOT NULL,
  commit_sha   TEXT NOT NULL,
  branch       TEXT,
  source       TEXT NOT NULL CHECK(source IN ('github','jenkins','simulate')),
  raw_log      TEXT NOT NULL,
  cleaned_log  TEXT,
  truncated    INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK(status IN ('pending','complete','unavailable')),
  category     TEXT,
  explanation  TEXT,
  suggested_fix TEXT,
  confidence   TEXT CHECK(confidence IN ('high','medium','low')),
  retry_count  INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at   TEXT NOT NULL,
  completed_at TEXT,
  auto_fix_pr_url TEXT,           -- stretch: GitHub PR URL
  embedding    TEXT,               -- stretch: JSON-serialized float array
  similar_to   TEXT,               -- stretch: JSON-serialized SimilarMatch object
  failing_tests TEXT,              -- stretch: JSON-serialized string array
  flaky_tests  TEXT                -- stretch: JSON-serialized FlakyTest array
);

CREATE INDEX idx_build_records_status    ON build_records(status);
CREATE INDEX idx_build_records_created   ON build_records(created_at DESC);
CREATE INDEX idx_build_records_category  ON build_records(category);
CREATE INDEX idx_build_records_repo_category_created 
  ON build_records(repo_name, category, created_at DESC);  -- for flakiness queries
```

**Validation Rules**:
- `id` is a UUID v4 generated at insert time
- `commitSha` must be a 40-character hex string (SHA-1) or a 64-character hex string (SHA-256)
- `source` must be one of the three allowed values
- `retryCount` ≤ 1 (max one retry)
- `completedAt` is set only when `status` transitions from `pending`
- `autoFixPrUrl` is set only when AutoFixService successfully creates a PR (stretch)
- `embedding` stores JSON-serialized array of floats when SimilarityService succeeds (stretch)
- `similarTo` stores JSON `{ buildRecordId: string, similarityScore: number }` when similarity > 0.85 (stretch)
- `failingTests` stores JSON-serialized string array when `category = "test-failure"` and LLM extracts test names (stretch)
- `flakyTests` stores JSON-serialized array of `{ testName: string, failureRate: string }` when FlakinessTracker detects flaky tests (stretch)

---

### SimulationFixture

```typescript
interface SimulationFixture {
  scenario: SimulationScenario;
  repoName: string;
  jobName: string;
  commitSha: string;
  branch: string;
  rawLog: string;
}
```

Fixtures are static JSON/text files in `/backend/fixtures/` — one per scenario. They are bundled with the application and never stored in the database.

---

### FeedbackRecord (stretch)

> **Stretch Feature**: Only present when the helpfulness feedback feature is enabled.

```typescript
interface FeedbackRecord {
  id: string;               // UUID v4
  buildRecordId: string;    // FK → build_records.id
  clientId: string;         // anonymous UUID from localStorage
  rating: "helpful" | "unhelpful";
  createdAt: Date;
}
```

**SQLite DDL**:
```sql
CREATE TABLE feedback (
  id              TEXT PRIMARY KEY,
  build_record_id TEXT NOT NULL REFERENCES build_records(id),
  client_id       TEXT NOT NULL,
  rating          TEXT NOT NULL CHECK(rating IN ('helpful','unhelpful')),
  created_at      TEXT NOT NULL,
  UNIQUE(build_record_id, client_id)   -- enforces one rating per client per diagnosis; upsert replaces
);

CREATE INDEX idx_feedback_build_record ON feedback(build_record_id);
CREATE INDEX idx_feedback_category     ON feedback(build_record_id);  -- used by stats query via JOIN
```

**Validation Rules**:
- `id` is a UUID v4 generated at insert time
- `buildRecordId` must reference an existing row in `build_records`
- `rating` must be exactly `"helpful"` or `"unhelpful"`
- The `UNIQUE(build_record_id, client_id)` constraint enforces one-rating-per-client-per-diagnosis; upsert (INSERT OR REPLACE) replaces any prior rating

---

### GitHubTokenRecord (stretch)

> **Stretch Feature**: Only present when the GitHub OAuth connection feature is enabled (Requirement 17).

```typescript
interface GitHubTokenRecord {
  clientId: string;           // anonymous UUID from localStorage (same as feedback feature)
  encryptedToken: string;     // AES-256-GCM encrypted GitHub OAuth access token
  githubUsername: string | null;  // GitHub username for display purposes
  createdAt: Date;
}
```

**SQLite DDL**:
```sql
CREATE TABLE github_tokens (
  client_id        TEXT PRIMARY KEY,
  encrypted_token  TEXT NOT NULL,
  github_username  TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX idx_github_tokens_created ON github_tokens(created_at DESC);
```

**Validation Rules**:
- `client_id` must be a valid UUID v4 (same format as used in helpfulness feedback)
- `encrypted_token` stores the GitHub OAuth access token encrypted using AES-256-GCM with a key derived from `TOKEN_ENCRYPTION_KEY` via `crypto.scrypt` with salt
- `github_username` is populated best-effort by calling `GET /user` after token exchange; if the call fails, remains null (does not block the OAuth flow)
- The `client_id` PRIMARY KEY enforces one token per client; re-authenticating replaces the existing token
- Tokens are decrypted only when needed for GitHub API calls and never logged or returned to the frontend in plaintext

---

## Algorithmic Pseudocode

### Main Ingestion Algorithm

```pascal
PROCEDURE ingestBuild(payload, source)
  INPUT: payload (WebhookPayload | SimulateRequest), source string
  OUTPUT: BuildRecord with status=pending

  SEQUENCE
    // Validate
    IF NOT isValidPayload(payload) THEN
      RAISE ValidationError("Missing required fields")
    END IF

    // Persist
    record ← BuildRecord.create({
      id: generateUUID(),
      repoName: payload.repoName,
      jobName: payload.jobName,
      commitSha: payload.commitSha,
      source: source,
      rawLog: payload.log,
      status: "pending",
      createdAt: now()
    })
    db.save(record)

    // Enqueue (non-blocking)
    jobQueue.enqueue({ buildRecordId: record.id })

    RETURN record
  END SEQUENCE
END PROCEDURE
```

**Preconditions**:
- `payload` contains non-empty `log`, `repoName`, `jobName`, `commitSha`
- `source` is one of `"github"`, `"jenkins"`, `"simulate"`

**Postconditions**:
- A `BuildRecord` with `status = "pending"` exists in the database
- A job has been enqueued; the procedure returns before the job executes
- The returned record ID can be used to poll for diagnosis results

---

### Log Truncation Algorithm

```pascal
PROCEDURE truncateLog(rawLog, options)
  INPUT: rawLog string, options TruncateOptions
  OUTPUT: TruncateResult

  SEQUENCE
    lines ← splitByNewline(rawLog)
    
    IF length(lines) <= options.maxLines THEN
      RETURN { cleanedLog: stripAnsi(rawLog), originalLineCount: length(lines), truncated: false }
    END IF

    // Phase 1: collect tail lines
    tailSet ← last(lines, options.tailLines)  // preserves order

    // Phase 2: collect keyword lines
    keywordSet ← empty set
    FOR i ← 0 TO length(lines) - 1 DO
      // Loop Invariant: |keywordSet| <= options.keywordLines
      IF matchesAnyKeyword(lines[i], options.keywords) THEN
        keywordSet.add({ lineNumber: i, text: lines[i] })
        IF |keywordSet| >= options.keywordLines THEN
          BREAK
        END IF
      END IF
    END FOR

    // Phase 3: two-block output — keyword-only lines first, then tail lines (Req 4.6)
    keywordOnlySet ← keywordSet minus any entries whose lineNumber appears in tailSet
    keywordOnlyLines ← sortByLineNumber(keywordOnlySet)   // sorted by original line number
    cleanedKeywordLines ← stripAnsi(keywordOnlyLines.map(entry => entry.text))
    cleanedTailLines ← stripAnsi(tailSet.map(entry => entry.text))  // tailSet already in original order

    retainedCount ← length(cleanedKeywordLines) + length(cleanedTailLines)
    notice ← "[Log truncated: showing " + retainedCount + " of " + length(lines) + " lines]"
    cleanedLog ← notice + NEWLINE + join(cleanedKeywordLines, NEWLINE) + NEWLINE + join(cleanedTailLines, NEWLINE)

    RETURN { cleanedLog, originalLineCount: length(lines), truncated: true }
  END SEQUENCE
END PROCEDURE
```

**Preconditions**:
- `rawLog` is a non-null string (may be empty)
- `options.tailLines + options.keywordLines <= options.maxLines`

**Postconditions**:
- Result `cleanedLog` contains no ANSI escape sequences
- If `truncated = false`, `cleanedLog` is equivalent to `stripAnsi(rawLog)`
- If `truncated = true`, `cleanedLog` begins with a truncation notice, followed by a keyword-only block (lines not in `tailSet`, sorted by original line number), then the tail block (last N lines in original order)
- `|cleanedLog lines| <= options.maxLines + 1` (header + at most maxLines content lines)

**Loop Invariant**: At the start of each iteration, `|keywordSet|` ≤ `options.keywordLines`

---

### LLM Diagnosis Algorithm

```pascal
PROCEDURE diagnoseBuild(input)
  INPUT: input DiagnosisInput
  OUTPUT: DiagnosisResult

  SEQUENCE
    prompt ← buildSystemPrompt()
    userMessage ← buildUserMessage(input.cleanedLog, input.repoName, input.jobName)

    response ← llmAPI.complete({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: prompt },
        { role: "user",   content: userMessage }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    })

    raw ← response.choices[0].message.content
    parsed ← JSON.parse(raw)

    IF NOT isValidDiagnosisResult(parsed) THEN
      RAISE LLMParseError("Response missing required fields", raw)
    END IF

    RETURN parsed AS DiagnosisResult
  END SEQUENCE
END PROCEDURE

PROCEDURE buildSystemPrompt()
  OUTPUT: string

  RETURN """
You are a CI/CD failure analysis expert. Analyze the provided build log and
return ONLY a JSON object with these fields:
{
  "category": one of [dependency-build-error, test-failure, docker-build-failure,
                       env-var-secrets, timeout-infrastructure, syntax-lint-error, unknown],
  "explanation": "2-5 sentence plain-English root cause",
  "suggestedFix": "markdown string with concrete fix steps and corrected code/config where relevant",
  "confidence": one of [high, medium, low]
}
Do not include any text outside the JSON object.
"""
END PROCEDURE
```

**Preconditions**:
- `input.cleanedLog` is non-empty
- `LLM_MODEL` and `LLM_API_KEY` environment variables are set

**Postconditions**:
- Returns a `DiagnosisResult` that passes `isValidDiagnosisResult()` schema check
- Throws `LLMParseError` if response cannot be parsed or validated

---

### Job Processing Algorithm (with Retry)

```pascal
PROCEDURE processJob(job)
  INPUT: job DiagnosisJob
  OUTPUT: void (side effect: updates BuildRecord in DB)

  SEQUENCE
    record ← db.findById(job.buildRecordId)
    IF record IS NULL THEN
      LOG "Record not found, skipping job"
      RETURN
    END IF

    truncateResult ← truncateLog(record.rawLog)
    db.update(record.id, { cleanedLog: truncateResult.cleanedLog, truncated: truncateResult.truncated })

    attempt ← 0
    WHILE attempt < MAX_RETRIES DO  // MAX_RETRIES = 2 (initial + 1 retry)
      // Loop Invariant: attempt <= MAX_RETRIES AND record.status = "pending"
      TRY
        result ← diagnoseBuild({
          cleanedLog: truncateResult.cleanedLog,
          repoName: record.repoName,
          jobName: record.jobName,
          source: record.source
        })
        db.update(record.id, {
          status: "complete",
          category: result.category,
          explanation: result.explanation,
          suggestedFix: result.suggestedFix,
          confidence: result.confidence,
          retryCount: attempt,
          completedAt: now()
        })
        // Fire-and-forget notification (stretch) — never blocks job completion
        TRY
          notificationService.notify(record, result)  // async, not awaited to completion
        CATCH NotificationError AS notifErr
          LOG "Notification failed: " + notifErr.message
        END TRY
        
        // Fire-and-forget auto-fix (stretch) — never blocks job completion
        TRY
          IF isAutoFixEligible(result) THEN
            prUrl ← autoFixService.createFix(record, result)
            IF prUrl IS NOT NULL THEN
              db.update(record.id, { autoFixPrUrl: prUrl })
            END IF
          END IF
        CATCH AutoFixError AS afErr
          LOG "Auto-fix failed: " + afErr.message
        END TRY
        
        // Fire-and-forget similarity search (stretch) — never blocks job completion
        TRY
          embedding ← similarityService.generateEmbedding(truncateResult.cleanedLog)
          IF embedding IS NOT NULL THEN
            db.update(record.id, { embedding: JSON.stringify(embedding) })
            similarMatch ← similarityService.findSimilar(embedding, record.id)
            IF similarMatch IS NOT NULL THEN
              db.update(record.id, { similarTo: JSON.stringify(similarMatch) })
            END IF
          END IF
        CATCH SimilarityError AS simErr
          LOG "Similarity search failed: " + simErr.message
        END TRY
        
        // Fire-and-forget flakiness detection (stretch) — never blocks job completion
        TRY
          IF result.category = "test-failure" AND result.failingTests IS NOT NULL THEN
            db.update(record.id, { failingTests: JSON.stringify(result.failingTests) })
            flakyTests ← flakinessTracker.checkFlaky(record)
            IF flakyTests IS NOT NULL THEN
              db.update(record.id, { flakyTests: JSON.stringify(flakyTests) })
            END IF
          END IF
        CATCH FlakinessError AS flkErr
          LOG "Flakiness detection failed: " + flkErr.message
        END TRY
        
        RETURN
      CATCH LLMParseError, NetworkError AS err
        attempt ← attempt + 1
        IF attempt < MAX_RETRIES THEN
          WAIT exponentialBackoff(attempt)  // 1s, then 2s
        END IF
      END TRY
    END WHILE

    // All attempts exhausted
    db.update(record.id, {
      status: "unavailable",
      retryCount: MAX_RETRIES - 1,
      errorMessage: err.message,
      completedAt: now()
    })
  END SEQUENCE
END PROCEDURE

FUNCTION isAutoFixEligible(result)
  INPUT: result ExtendedDiagnosisResult
  OUTPUT: boolean

  IF NOT (env.GITHUB_TOKEN IS SET AND env.GITHUB_REPO IS SET) THEN
    RETURN false
  END IF
  
  IF result.category NOT IN ["dependency-build-error", "docker-build-failure"] THEN
    RETURN false
  END IF
  
  IF result.confidence ≠ "high" THEN
    RETURN false
  END IF
  
  IF result.autoFixable ≠ true OR result.autoFixFile IS NULL THEN
    RETURN false
  END IF
  
  IF result.autoFixFile.path = "" OR result.autoFixFile.content = "" THEN
    RETURN false
  END IF
  
  RETURN true
END FUNCTION
```

**Preconditions**:
- `job.buildRecordId` refers to an existing `BuildRecord` with `status = "pending"`
- `MAX_RETRIES = 2`

**Postconditions**:
- `BuildRecord.status` is either `"complete"` or `"unavailable"` (never stays `"pending"`)
- If `"complete"`: all diagnosis fields are populated and non-null
- If `"unavailable"`: `errorMessage` is set, diagnosis fields remain null
- `retryCount` reflects the number of attempts made (0 or 1)
- If stretch features are enabled and eligible, `autoFixPrUrl`, `embedding`, `similarTo`, `failingTests`, and `flakyTests` may be populated
- Stretch feature failures never affect `status` or primary diagnosis fields

**Loop Invariant**: At the start of each iteration, `attempt ≤ MAX_RETRIES` and `record.status = "pending"` in the database

---

### Auto-Fix Pull Request Algorithm (stretch)

```pascal
PROCEDURE createFix(record, result)
  INPUT: record BuildRecord, result ExtendedDiagnosisResult
  OUTPUT: string (PR URL) or null

  SEQUENCE
    // Precondition checks
    IF env.GITHUB_TOKEN IS NULL OR env.GITHUB_TOKEN = "" THEN
      RETURN null
    END IF
    
    IF env.GITHUB_REPO IS NULL OR env.GITHUB_REPO = "" THEN
      RETURN null
    END IF
    
    TRY
      // Initialize GitHub client
      github ← new Octokit({ auth: env.GITHUB_TOKEN })
      [owner, repo] ← splitOwnerRepo(env.GITHUB_REPO)
      
      // Get default branch
      repoInfo ← github.repos.get({ owner, repo })
      defaultBranch ← repoInfo.data.default_branch
      
      // Get default branch SHA
      branchRef ← github.git.getRef({ owner, repo, ref: "heads/" + defaultBranch })
      baseSha ← branchRef.data.object.sha
      
      // Create new branch
      branchName ← "cicd-doctor-fix/" + record.id
      github.git.createRef({
        owner: owner,
        repo: repo,
        ref: "refs/heads/" + branchName,
        sha: baseSha
      })
      
      // Get current file content if it exists (for blob update)
      TRY
        existingFile ← github.repos.getContent({
          owner: owner,
          repo: repo,
          path: result.autoFixFile.path,
          ref: defaultBranch
        })
        // File exists — we'll update it
      CATCH NotFoundError
        // File doesn't exist — we'll create it (no-op, just proceed)
        existingFile ← null
      END TRY
      
      // Create or update file
      commitMessage ← "Auto-fix: " + result.category + " diagnosed in " + record.jobName
      github.repos.createOrUpdateFileContents({
        owner: owner,
        repo: repo,
        path: result.autoFixFile.path,
        message: commitMessage,
        content: base64Encode(result.autoFixFile.content),
        branch: branchName,
        sha: IF existingFile IS NOT NULL THEN existingFile.data.sha ELSE undefined
      })
      
      // Create pull request
      prTitle ← "Auto-fix: " + result.category + " in " + record.jobName
      detailUrl ← env.APP_BASE_URL + "/diagnoses/" + record.id
      prBody ← result.explanation + "\n\n---\n\n[View full diagnosis](" + detailUrl + ")"
      
      pr ← github.pulls.create({
        owner: owner,
        repo: repo,
        title: prTitle,
        body: prBody,
        head: branchName,
        base: defaultBranch
      })
      
      RETURN pr.data.html_url
      
    CATCH GitHubAPIError, NetworkError AS err
      LOG "Auto-fix failed for buildRecordId " + record.id + ": " + err.message
      RETURN null
    END TRY
  END SEQUENCE
END PROCEDURE
```

**Preconditions**:
- `result.autoFixable = true`
- `result.autoFixFile.path` and `result.autoFixFile.content` are non-empty
- `record.category ∈ {"dependency-build-error", "docker-build-failure"}`
- `record.confidence = "high"`

**Postconditions**:
- On success: returns GitHub PR URL (string)
- On error: logs error message, returns null
- Never throws exceptions — all errors caught internally

---

### Similarity Search Algorithm (stretch)

```pascal
PROCEDURE generateEmbedding(cleanedLog)
  INPUT: cleanedLog string
  OUTPUT: number[] or null

  SEQUENCE
    TRY
      response ← llmAPI.embeddings.create({
        model: "text-embedding-ada-002",  // or compatible model
        input: cleanedLog
      })
      
      embedding ← response.data[0].embedding  // array of floats
      
      IF embedding IS NULL OR length(embedding) = 0 THEN
        RAISE ParseError("Empty embedding returned")
      END IF
      
      RETURN embedding
      
    CATCH NetworkError, APIError, ParseError AS err
      LOG "Embedding generation failed: " + err.message
      RETURN null
    END TRY
  END SEQUENCE
END PROCEDURE

PROCEDURE findSimilar(embedding, currentRecordId)
  INPUT: embedding number[], currentRecordId string
  OUTPUT: SimilarMatch or null

  SEQUENCE
    TRY
      // Query all complete records with embeddings, excluding current
      candidates ← db.query(
        "SELECT id, embedding, category, created_at FROM build_records 
         WHERE status = 'complete' AND embedding IS NOT NULL AND id != ?
         ORDER BY created_at DESC",
        [currentRecordId]
      )
      
      maxSimilarity ← 0.0
      bestMatch ← null
      
      FOR EACH candidate IN candidates DO
        // Loop Invariant: maxSimilarity ≤ 1.0 AND (bestMatch = null OR maxSimilarity > 0.85)
        candidateEmbedding ← JSON.parse(candidate.embedding)
        
        // Compute cosine similarity
        dotProduct ← 0.0
        normA ← 0.0
        normB ← 0.0
        
        FOR i ← 0 TO length(embedding) - 1 DO
          dotProduct ← dotProduct + (embedding[i] * candidateEmbedding[i])
          normA ← normA + (embedding[i] * embedding[i])
          normB ← normB + (candidateEmbedding[i] * candidateEmbedding[i])
        END FOR
        
        // Handle division by zero
        IF normA = 0.0 OR normB = 0.0 THEN
          CONTINUE  // skip this candidate
        END IF
        
        similarity ← dotProduct / (sqrt(normA) * sqrt(normB))
        
        IF similarity > maxSimilarity AND similarity > 0.85 THEN
          maxSimilarity ← similarity
          bestMatch ← {
            buildRecordId: candidate.id,
            similarityScore: similarity
          }
        END IF
      END FOR
      
      RETURN bestMatch  // may be null if no match > 0.85
      
    CATCH DatabaseError, ComputationError AS err
      LOG "Similarity search failed: " + err.message
      RETURN null
    END TRY
  END SEQUENCE
END PROCEDURE
```

**Preconditions** (generateEmbedding):
- `cleanedLog` is a non-empty string
- `LLM_API_KEY` is set

**Postconditions** (generateEmbedding):
- On success: returns float array of length determined by embedding model (typically 1536 for ada-002)
- On error: logs error, returns null

**Preconditions** (findSimilar):
- `embedding` is a non-empty float array
- `currentRecordId` exists in database

**Postconditions** (findSimilar):
- Returns `SimilarMatch` with similarity > 0.85 if found, else null
- Never modifies database
- Computation completes within reasonable time for hackathon scale (<10,000 records)

**Loop Invariant**: `maxSimilarity ≤ 1.0` AND (`bestMatch = null` OR `maxSimilarity > 0.85`)

---

### Flakiness Detection Algorithm (stretch)

```pascal
PROCEDURE checkFlaky(record)
  INPUT: record BuildRecord
  OUTPUT: FlakyTest[] or null

  SEQUENCE
    // Precondition check
    IF record.category ≠ "test-failure" THEN
      RETURN null
    END IF
    
    IF record.failingTests IS NULL OR length(record.failingTests) = 0 THEN
      RETURN null
    END IF
    
    TRY
      // Query last 10 test-failure builds for same repo (including current)
      recentBuilds ← db.query(
        "SELECT id, failing_tests FROM build_records 
         WHERE repo_name = ? AND category = 'test-failure' AND failing_tests IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 10",
        [record.repoName]
      )
      
      windowSize ← length(recentBuilds)
      IF windowSize = 0 THEN
        RETURN null
      END IF
      
      // Count occurrences of each test name across window
      testCounts ← new Map<string, number>()
      
      FOR EACH build IN recentBuilds DO
        tests ← JSON.parse(build.failing_tests)
        FOR EACH testName IN tests DO
          IF testCounts.has(testName) THEN
            testCounts.set(testName, testCounts.get(testName) + 1)
          ELSE
            testCounts.set(testName, 1)
          END IF
        END FOR
      END FOR
      
      // Identify flaky tests (appear in 3+ builds)
      flakyTests ← []
      FOR EACH testName IN record.failingTests DO
        count ← testCounts.get(testName) OR 0
        IF count >= 3 THEN
          flakyTests.push({
            testName: testName,
            failureRate: count + "/" + windowSize
          })
        END IF
      END FOR
      
      IF length(flakyTests) = 0 THEN
        RETURN null  // No flaky tests detected
      END IF
      
      RETURN flakyTests
      
    CATCH DatabaseError, ParseError AS err
      LOG "Flakiness detection failed for buildRecordId " + record.id + ": " + err.message
      RETURN null
    END TRY
  END SEQUENCE
END PROCEDURE
```

**Preconditions**:
- `record.category = "test-failure"`
- `record.failingTests` is a non-empty JSON-serialized string array
- Database has index on `(repo_name, category, created_at)`

**Postconditions**:
- Returns array of `FlakyTest` objects for tests appearing in ≥3 of last 10 builds
- Returns null if no flaky tests detected or on error
- Never modifies input record
- Query uses index, completes in <100ms for typical dataset

---

### GitHub OAuth Connect-Repo Algorithm (stretch)

```pascal
PROCEDURE connectRepo(clientId, repoFullName)
  INPUT: clientId string, repoFullName string (e.g., "owner/repo")
  OUTPUT: ConnectRepoResponse or error

  SEQUENCE
    // Retrieve and decrypt stored token
    tokenRecord ← db.query(
      "SELECT encrypted_token FROM github_tokens WHERE client_id = ?",
      [clientId]
    )
    IF tokenRecord IS NULL THEN
      RAISE AuthError("No GitHub token found for this client. Please reconnect.")
    END IF
    accessToken ← decrypt(tokenRecord.encrypted_token, env.TOKEN_ENCRYPTION_KEY)

    // Parse owner/repo
    parts ← repoFullName.split("/")
    IF length(parts) ≠ 2 THEN
      RAISE ValidationError("repoFullName must be in 'owner/repo' format")
    END IF
    owner ← parts[0]
    repo  ← parts[1]

    // Fetch repository public key for secret encryption
    pubKeyResponse ← githubAPI.GET(
      "/repos/{owner}/{repo}/actions/secrets/public-key",
      Authorization: "Bearer " + accessToken
    )
    IF pubKeyResponse.status = 401 THEN
      RAISE AuthError("GitHub token invalid or expired. Please reconnect.")
    END IF
    IF pubKeyResponse.status = 403 AND pubKeyResponse.headers["X-RateLimit-Remaining"] = "0" THEN
      RAISE RateLimitError("GitHub API rate limit exceeded", pubKeyResponse.headers["X-RateLimit-Reset"])
    END IF
    IF pubKeyResponse.status = 403 THEN
      RAISE PermissionError("You do not have write access to " + repoFullName)
    END IF
    publicKey ← pubKeyResponse.body.key
    keyId     ← pubKeyResponse.body.key_id

    // Encrypt WEBHOOK_SECRET using libsodium sealed box
    encryptedWebhookSecret ← sodiumSealedBox(env.WEBHOOK_SECRET, publicKey)
    encryptedAppUrl        ← sodiumSealedBox(env.APP_BASE_URL, publicKey)

    // Create repository secrets (step 1)
    secretsOk ← false
    TRY
      githubAPI.PUT("/repos/{owner}/{repo}/actions/secrets/CICD_DOCTOR_SECRET",
        { encrypted_value: encryptedWebhookSecret, key_id: keyId },
        Authorization: "Bearer " + accessToken
      )
      githubAPI.PUT("/repos/{owner}/{repo}/actions/secrets/CICD_DOCTOR_URL",
        { encrypted_value: encryptedAppUrl, key_id: keyId },
        Authorization: "Bearer " + accessToken
      )
      secretsOk ← true
    CATCH err
      RAISE SecretCreationError("Failed to create repository secrets: " + err.message)
    END TRY

    // Create workflow file (step 2) — secrets already created; partial failure reported as 207
    workflowContent ← buildWorkflowYaml()  // generates cicd-failure-doctor.yml referencing secrets
    workflowPath    ← ".github/workflows/cicd-failure-doctor.yml"
    TRY
      response ← githubAPI.PUT(
        "/repos/{owner}/{repo}/contents/" + workflowPath,
        {
          message: "Add CI/CD Failure Doctor workflow",
          content: base64(workflowContent)
        },
        Authorization: "Bearer " + accessToken
      )
      workflowUrl ← response.body.content.html_url
      RETURN { success: true, repoFullName: repoFullName, workflowUrl: workflowUrl }
    CATCH err
      // Secrets were created; report partial success rather than total failure
      LOG WARN "Workflow file creation failed after secrets were created: " + err.message
      RETURN_STATUS 207 {
        secretsCreated: true,
        workflowCreated: false,
        error: "Secrets were created but the workflow file could not be added: " + err.message,
        manualSetupUrl: env.APP_BASE_URL + "/docs/manual-setup"
      }
    END TRY
  END SEQUENCE
END PROCEDURE
```

**Preconditions**:
- `clientId` maps to a valid encrypted token in `github_tokens`
- `repoFullName` is a non-empty string in `owner/repo` format
- `WEBHOOK_SECRET` and `APP_BASE_URL` environment variables are set

**Postconditions**:
- On full success: exactly two named secrets and one named workflow file exist in the target repo; no other repo content is modified
- On partial success (HTTP 207): exactly two named secrets exist; no workflow file was written; the caller is informed and directed to manual setup
- On any error before secrets are created: no changes are made to the target repo

**Invariant**: For any execution path, the number of files modified in the target repo is ∈ {0, 2 secrets only, 2 secrets + 1 workflow file} — never any other combination

---

### Webhook Authentication Algorithm

```pascal
PROCEDURE validateWebhookRequest(request)
  INPUT: request HttpRequest
  OUTPUT: { valid: boolean, statusCode: 401 | 500 | null }

  SEQUENCE
    // Defense-in-depth check: misconfigured server returns 500, not 401.
    // Req 11.2's startup check should prevent this in normal operation.
    expected ← env.WEBHOOK_SECRET
    IF expected IS NULL OR expected = "" THEN
      LOG ERROR "WEBHOOK_SECRET env var not configured — returning 500"
      RETURN { valid: false, statusCode: 500 }
    END IF

    secret ← request.headers["x-webhook-secret"]
    IF secret IS NULL OR secret = "" THEN
      RETURN { valid: false, statusCode: 401 }
    END IF

    // Constant-time comparison to prevent timing attacks
    IF timingSafeEqual(secret, expected) THEN
      RETURN { valid: true, statusCode: null }
    ELSE
      RETURN { valid: false, statusCode: 401 }
    END IF
  END SEQUENCE
END PROCEDURE
```

**Preconditions**:
- `WEBHOOK_SECRET` environment variable is set in the deployment environment

**Postconditions**:
- Returns `{ valid: true }` if and only if `WEBHOOK_SECRET` is configured and the header matches it
- Returns `{ valid: false, statusCode: 401 }` when the header is absent, empty, or mismatched and `WEBHOOK_SECRET` is configured
- Returns `{ valid: false, statusCode: 500 }` when `WEBHOOK_SECRET` is not set — server misconfiguration, not a client auth failure (Req 9.5)
- The value comparison always uses constant-time equality to prevent timing attacks

---

## Key Functions with Formal Specifications

### `ingestBuild(payload, source): Promise<BuildRecord>`

**Preconditions**:
- `payload.log.length > 0`
- `payload.repoName`, `payload.jobName`, `payload.commitSha` are non-empty strings
- `source ∈ {"github", "jenkins", "simulate"}`

**Postconditions**:
- A row exists in `build_records` with the returned `id`
- `status = "pending"` at return time
- A diagnosis job has been enqueued (not yet processed)
- Function returns in < 200 ms (no LLM call on this path)

---

### `truncateLog(rawLog, options?): TruncateResult`

**Preconditions**:
- `rawLog` is a string (may be empty)

**Postconditions**:
- `result.cleanedLog` contains no ANSI escape codes
- `result.originalLineCount = rawLog.split('\n').length`
- `result.truncated = (originalLineCount > options.maxLines)`
- If `truncated`, `result.cleanedLog.split('\n').length <= options.maxLines + 1` (header line)

---

### `diagnoseBuild(input): Promise<DiagnosisResult>`

**Preconditions**:
- `input.cleanedLog.length > 0`
- Environment variables `LLM_API_KEY` and `LLM_MODEL` are set

**Postconditions**:
- On success: returns object satisfying `isValidDiagnosisResult(result) = true`
- On failure: throws `LLMParseError` with the raw response attached

---

### `processJob(job): Promise<void>`

**Preconditions**:
- `job.buildRecordId` exists in `build_records` with `status = "pending"`

**Postconditions**:
- `build_records[job.buildRecordId].status ∈ {"complete", "unavailable"}`
- `build_records[job.buildRecordId].completed_at` is set
- If complete: `category`, `explanation`, `suggested_fix`, `confidence` are all non-null
- If `NotificationService` is configured, a notification is dispatched but its success/failure does not affect `BuildRecord.status`

---

### `notificationService.notify(record, result): Promise<void>` (stretch)

> **Stretch Feature**

**Preconditions**:
- `record.status = "complete"`
- `result.explanation` is a non-empty string

**Postconditions**:
- If `SLACK_WEBHOOK_URL` is set: an HTTP POST was attempted to that URL
- If `NOTIFICATION_EMAIL` is set: an email send was attempted to that address
- `record` is not modified under any outcome
- Function always resolves (never rejects); errors are caught and logged

---

### `feedbackService.upsertFeedback(buildRecordId, clientId, rating): Promise<FeedbackRecord>` (stretch)

> **Stretch Feature**

**Preconditions**:
- `buildRecordId` exists in `build_records`
- `clientId` is a non-empty string
- `rating ∈ {"helpful", "unhelpful"}`

**Postconditions**:
- Exactly one row exists in `feedback` with `(build_record_id = buildRecordId, client_id = clientId)`
- That row's `rating` equals the provided `rating` (prior value replaced if different)
- If `NotificationService` is configured, a notification is dispatched but its success/failure does not affect `BuildRecord.status`

---

## Example Usage

```typescript
// 1. Real webhook from GitHub Actions
// POST /webhook/ingest
// Headers: X-Webhook-Secret: mysecret
const webhookPayload = {
  log: "...long build output...",
  repoName: "acme/payments-service",
  jobName: "CI / build-and-test",
  commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  source: "github",
  branch: "feat/add-stripe"
};
// Response: 202 { id: "uuid-here", status: "pending" }

// 2. Simulate a failed build (demo path)
// POST /simulate
const simReq = { scenario: "test-failure" };
// Response: 202 { id: "uuid-here", scenario: "test-failure", status: "pending" }

// 3. Poll for results
// GET /diagnoses?page=1&limit=20
// Response includes rows with status progressing pending → complete|unavailable

// 4. Fetch full diagnosis detail
// GET /diagnoses/uuid-here
// Response:
const detail: DiagnosisDetail = {
  id: "uuid-here",
  repoName: "acme/payments-service",
  jobName: "CI / build-and-test",
  commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  source: "github",
  status: "complete",
  category: "test-failure",
  explanation: "3 unit tests in PaymentService failed due to a mocked Stripe client returning an unexpected error shape after the recent refactor. The tests expected `error.code` but the new client throws an object with `error.type`.",
  suggestedFix: "Update the mock in `__tests__/payment.test.ts`:\n```ts\njest.mock('../stripe', () => ({ charge: jest.fn().mockRejectedValue({ type: 'card_error', message: 'declined' }) }));\n```",
  confidence: "high",
  createdAt: "2024-01-15T10:23:45Z",
  completedAt: "2024-01-15T10:23:52Z",
  suggestedFix: "...",
  rawLog: "...",
  truncated: true
};

// 5. Submit helpfulness feedback (stretch)
// POST /diagnoses/uuid-here/feedback
// Headers: X-Client-Id: client-uuid-from-localstorage
const feedbackReq: FeedbackRequest = { rating: "helpful" };
// Response: 200 { id: "feedback-uuid", buildRecordId: "uuid-here", clientId: "...", rating: "helpful", createdAt: "..." }

// 6. Get feedback stats (stretch)
// GET /feedback/stats
// Response:
const stats: FeedbackStatsResponse = {
  stats: [
    { category: "test-failure",           helpful: 12, unhelpful: 2 },
    { category: "dependency-build-error", helpful: 8,  unhelpful: 1 },
    { category: "docker-build-failure",   helpful: 0,  unhelpful: 0 },
    // ... all 7 categories always present
  ]
};

// 7. Trigger notification (internal — called by job queue after status=complete)
// notificationService.notify(record, result)
// → POST https://hooks.slack.com/... { text: "[test-failure] 3 unit tests failed... https://myapp.com/diagnoses/uuid-here" }
// → sendEmail("dev@example.com", subject: "CI/CD Failure Diagnosed", body: "...")
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Webhook Non-Blocking

For all valid webhook requests, the HTTP response is returned before any LLM API call is initiated. Response time ≤ 2 seconds in all cases.

**Validates: Requirements 1.4**

### Property 2: Secret Validation Completeness

For all requests to `/webhook/ingest`, if the `X-Webhook-Secret` header is absent, empty, or does not match `WEBHOOK_SECRET`, the response status is 401 and no BuildRecord is persisted.

**Validates: Requirements 1.2, 9.3**

### Property 3: Diagnosis Termination

For all enqueued jobs, `processJob` terminates with the record's `status` set to either `"complete"` or `"unavailable"`. No record remains permanently `"pending"`.

**Validates: Requirements 3.1, 3.5**

### Property 4: Retry Bound

For all jobs that encounter LLM errors, the LLM is called at most 2 times (initial attempt + 1 retry). `retry_count ≤ 1` in all completed records.

**Validates: Requirements 6.4**

### Property 5: Log Truncation Safety

For all string inputs, `truncateLog` returns a result free of ANSI escape codes, and if the input exceeds `maxLines`, the output line count is ≤ `maxLines + 1` (the truncation header counts as one line).

**Validates: Requirements 4.1, 4.5**

### Property 6: Simulate Parity

For all simulation scenarios, the code path through `ingestBuild` and `processJob` is identical to the real webhook path. No separate LLM-skipping logic exists in simulate mode.

**Validates: Requirements 2.4**

### Property 7: Unavailable State Integrity

For all records with `status = "unavailable"`, `explanation`, `category`, `suggested_fix`, and `confidence` are null, and `error_message` is non-null.

**Validates: Requirements 6.3**

### Property 8: Schema Validity

For all records with `status = "complete"`, `category ∈ FailureCategory`, `confidence ∈ {"high","medium","low"}`, and `explanation` is a non-empty string.

**Validates: Requirements 5.4, 5.5**

### Property 9: LLM Response Parse Round-Trip

For any valid `DiagnosisResult` object, serializing it to JSON and passing it through `LLM_Client`'s parse-and-validate path produces an equivalent object. For any string that is not valid JSON or is missing required fields, the parse step throws `LLMParseError`.

**Validates: Requirements 5.2, 5.3**

### Property 10: Notification Non-Interference (stretch)

For all `processJob` executions, the `BuildRecord.status` and all diagnosis fields are set to their final values before `notificationService.notify()` is called, and the outcome of `notify()` (success or failure) does not modify any field of the `BuildRecord`.

**Validates: Requirements 12.3**

### Property 11: Feedback Upsert Idempotence (stretch)

For any `(buildRecordId, clientId)` pair, submitting N feedback requests with the same `rating` results in exactly one row in the `feedback` table. Submitting with a different `rating` replaces the prior rating, leaving exactly one row.

**Validates: Requirements 13.2**

---

### Property 12: Diagnosis SLA Bound

For all BuildRecords that enter the job queue, the record's `status` is set to either `"complete"` or `"unavailable"` within 120 seconds of being dequeued. No record remains in `status = "pending"` for longer than 120 seconds after its job begins processing.

**Validates: Requirements 3.5**

---

### Property 13: Auto-Fix Category Constraint (stretch)

For all BuildRecords with non-null `auto_fix_pr_url`, the `category` is exactly `"dependency-build-error"` or `"docker-build-failure"` AND `confidence = "high"`.

**Validates: Requirements 14.1**

---

### Property 14: Similarity Non-Interference (stretch)

For all BuildRecords processed by SimilarityService, the presence or absence of non-null `embedding` and `similar_to` values does not modify the `category`, `explanation`, `suggested_fix`, or `confidence` fields. These stretch fields are purely additive.

**Validates: Requirements 15.7**

---

### Property 15: Flakiness Non-Interference (stretch)

For all BuildRecords processed by FlakinessTracker, the presence or absence of non-null `flaky_tests` values does not modify the `category`, `explanation`, `suggested_fix`, or `confidence` fields. This stretch field is purely additive.

**Validates: Requirements 16.8**

---

### Property 16: GitHub OAuth Non-Interference (stretch)
For all requests received when `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` is unset or empty, the system SHALL NOT register any `/auth/github/*`, `/github/*`, or `/config` routes that expose OAuth functionality. The set of active routes, database tables queried, and response shapes of all pre-existing endpoints (`/webhook/ingest`, `/simulate`, `/diagnoses`, `/diagnoses/:id`, `/diagnoses/:id/feedback`, `/feedback/stats`) SHALL be identical to the pre-Requirement-17 behavior.
**Validates: Requirements 17.2**

---

### Property 17: OAuth Token Confidentiality (stretch)
For all invocations of the GitHubConnectionService, the raw GitHub OAuth access token SHALL NOT appear in: any HTTP response body or header, any server log line, or any database column other than `github_tokens.encrypted_token` (which stores it AES-256-GCM encrypted). The only decrypted use of the token is as the value of the `Authorization: Bearer` header in outbound GitHub API calls made server-side.
**Validates: Requirements 17.5**

---

### Property 18: Connect-Repo Scope Restriction (stretch)
For any successful invocation of `POST /github/connect-repo` for a given `owner/repo`, the set of GitHub API write operations performed SHALL be exactly: one PUT to `secrets/CICD_DOCTOR_SECRET`, one PUT to `secrets/CICD_DOCTOR_URL`, and one PUT to `contents/.github/workflows/cicd-failure-doctor.yml`. No other files, secrets, branches, or repository settings SHALL be created, modified, or deleted in the target repository as a result of this call.
**Validates: Requirements 17.14**

---

## Error Handling

### Scenario 1: Invalid Webhook Secret

**Condition**: `X-Webhook-Secret` header is missing, empty, or does not match `WEBHOOK_SECRET`
**Response**: `401 Unauthorized` with body `{ error: "Invalid or missing webhook secret" }`
**Recovery**: CI system receives 401 and logs the failure; no record is created

---

### Scenario 2: Malformed Webhook Payload

**Condition**: Required fields (`log`, `repoName`, `jobName`, `commitSha`) are missing or empty
**Response**: `400 Bad Request` with body `{ error: "Validation failed", details: string[] }`
**Recovery**: CI system receives 400; developer inspects webhook configuration

---

### Scenario 3: LLM Returns Invalid JSON

**Condition**: LLM response body is not parseable JSON or is missing required fields
**Response**: Job processor catches `LLMParseError`, waits 1 second, retries once
**Recovery**: If retry succeeds → `status = "complete"`; if retry fails → `status = "unavailable"` with `errorMessage` set; dashboard shows "Diagnosis unavailable" badge

---

### Scenario 4: LLM API Network Error / Timeout

**Condition**: LLM API call times out (> 30 seconds) or returns a 5xx status
**Response**: Job processor treats as retryable error, waits 2 seconds, retries once
**Recovery**: Same as Scenario 3

---

### Scenario 5: Database Write Failure

**Condition**: SQLite write fails (disk full, locked file)
**Response**: Server logs the error; if during ingest → returns `500` to caller; if during job processing → job silently fails (record stays `pending`)
**Recovery**: Admin restarts service; pending records are re-queued on startup (stretch)

---

### Scenario 6: Very Large Log

**Condition**: Incoming log is > 100,000 lines
**Response**: `truncateLog` reduces to `maxLines` (300) before any LLM call
**Recovery**: Truncation notice prepended to cleaned log; `truncated = true` shown in UI

---

### Scenario 7: Notification Delivery Failure (stretch)

**Condition**: HTTP POST to `SLACK_WEBHOOK_URL` returns a non-2xx status, or SMTP send to `NOTIFICATION_EMAIL` throws a network error
**Response**: `NotificationService` catches the error, logs the message, and returns without retrying
**Recovery**: `BuildRecord.status` remains `"complete"`; the diagnosis is still visible on the dashboard. The failure is surfaced only in server logs.

---

### Scenario 8: Invalid Feedback Rating (stretch)

**Condition**: `POST /diagnoses/:id/feedback` body contains a `rating` value other than `"helpful"` or `"unhelpful"`, or the `X-Client-Id` header is absent or empty
**Response**: `400 Bad Request` with body `{ error: "Invalid rating value" }` or `{ error: "Missing X-Client-Id header" }` respectively; no row is written to the `feedback` table
**Recovery**: Dashboard displays an error toast; user can retry with a valid value

---

### Scenario 9: Payload Too Large

**Condition**: The total `POST /webhook/ingest` request body exceeds the 10 MB Express body parser limit
**Response**: Express rejects the request before the route handler runs; the handler returns `413 Payload Too Large` with body `{ error: "Payload too large" }`
**Recovery**: CI system receives 413; developer should check whether the raw log is being sent in full (consider pre-truncating on the sender side before posting) and retry with a smaller payload

---

### Scenario 10: Auto-Fix Branch Already Exists (stretch)

**Condition**: AutoFixService attempts to create branch `cicd-doctor-fix/{buildRecordId}` but a branch with that name already exists in the repository
**Response**: GitHub API returns `422 Unprocessable Entity`; AutoFixService catches the error, logs "Branch already exists for buildRecordId {id}", returns `null`
**Recovery**: `BuildRecord.auto_fix_pr_url` remains null; diagnosis completes with `status = "complete"`; dashboard shows diagnosis without auto-fix link; developer can manually delete the stale branch via GitHub UI and re-trigger if needed

---

### Scenario 11: Auto-Fix Insufficient Permissions (stretch)

**Condition**: `GITHUB_TOKEN` lacks write permissions (read-only token or insufficient repo scope)
**Response**: GitHub API returns `403 Forbidden` during branch creation or PR creation; AutoFixService catches, logs "Insufficient GitHub permissions for buildRecordId {id}: {error}", returns `null`
**Recovery**: Same as Scenario 10; diagnosis succeeds, auto-fix silently disabled for that record; admin should verify `GITHUB_TOKEN` has `repo` scope

---

### Scenario 12: LLM Embeddings API Error (stretch)

**Condition**: SimilarityService calls LLM embeddings endpoint but receives `500 Internal Server Error` or network timeout
**Response**: SimilarityService catches the error, logs "Embedding generation failed for buildRecordId {id}: {error}", sets `embedding = null`, skips similarity search
**Recovery**: Diagnosis completes with `status = "complete"` and all primary fields populated; `similar_to` remains null; dashboard shows diagnosis without similarity callout; user sees normal diagnosis result

---

### Scenario 13: Cosine Similarity Computation Overflow (stretch)

**Condition**: SimilarityService computes cosine similarity between two embedding vectors but encounters a division-by-zero (zero-magnitude vector) or NaN result
**Response**: SimilarityService catches the error during computation, logs "Similarity computation failed for buildRecordId {id}: division by zero or NaN", sets `similar_to = null`
**Recovery**: Same as Scenario 12; diagnosis succeeds without similarity data

---

### Scenario 14: Flakiness Query Returns Fewer Than 10 Builds (stretch)

**Condition**: FlakinessTracker queries for the 10 most recent test-failure builds for a repository but finds only 3 existing records (new repository or category)
**Response**: FlakinessTracker proceeds with the 3 available records; computes flakiness rates as "N/3" instead of "N/10"
**Recovery**: Diagnosis completes normally; flakiness detection works with smaller sample size; as more builds accumulate, the window expands naturally to 10

---

### Scenario 15: LLM Omits Optional Stretch Fields (stretch)

**Condition**: LLM response for a test-failure diagnosis is valid JSON with required fields (`category`, `explanation`, `suggestedFix`, `confidence`) but omits optional stretch fields (`autoFixable`, `autoFixFile`, `failingTests`)
**Response**: Job processor validates required fields successfully, proceeds to `status = "complete"`, skips auto-fix and flakiness processing for fields that are absent
**Recovery**: Diagnosis completes normally with all primary data; stretch features are silently disabled for that record; no error logged (expected behavior when stretch data unavailable)

---

### Scenario 16: GitHub OAuth State Mismatch (stretch)
**Condition**: A GET request arrives at `/auth/github/callback` where the `state` query parameter does not match the value stored in the user's session (e.g., CSRF attempt or stale browser tab)
**Response**: Backend returns HTTP 400 with body `{ "error": "Invalid OAuth state parameter" }`; no token exchange is attempted; no record is written to `github_tokens`
**Recovery**: User is shown an error and prompted to restart the flow by clicking "Connect GitHub" again; the CSRF guard functioned correctly

---

### Scenario 17: GitHub OAuth Token Expired or Revoked (stretch)
**Condition**: A stored OAuth token has been revoked by the user in GitHub (Settings → Applications → Authorized OAuth Apps) and a subsequent call to `/github/repos` or `/github/connect-repo` receives HTTP 401 from the GitHub API
**Response**: Backend returns HTTP 401 to the client with body `{ "error": "GitHub token invalid or expired. Please reconnect your account." }`; raw token value is not included in the response or server logs
**Recovery**: Dashboard detects the 401 and returns the user to the pre-connection state, showing the "Connect GitHub" button; the stale `github_tokens` record is replaced when the user reconnects

---

### Scenario 18: Secret Creation Succeeds but Workflow File Creation Fails (stretch)
**Condition**: During `POST /github/connect-repo`, both repository secrets (`CICD_DOCTOR_SECRET`, `CICD_DOCTOR_URL`) are created successfully but the workflow file PUT to the GitHub Contents API fails (e.g., temporary API error or insufficient branch-protection permissions on `.github/workflows/`)
**Response**: Backend returns HTTP 207 (Multi-Status) with a response body indicating which steps succeeded and which failed, plus a direct link to the manual setup instructions in design.md's CI Trigger Snippets section; the two created secrets are NOT rolled back
**Recovery**: User can follow the manual instructions to add the workflow file, reusing the secrets already in place; no existing workflows, secrets, or files in the repo are modified

---

### Scenario 19: GitHub API Rate Limit Hit (stretch)
**Condition**: Any GitHub API call during `/github/repos` or `/github/connect-repo` receives HTTP 403 with header `X-RateLimit-Remaining: 0`
**Response**: Backend returns HTTP 429 to the client with body `{ "error": "GitHub API rate limit exceeded", "resetAt": "<UTC timestamp from X-RateLimit-Reset header>" }`; no partial state is left in an ambiguous condition
**Recovery**: Dashboard displays the rate-limit message and reset time; user can retry after the limit resets; no diagnosis records or existing repo configuration are affected

---

### Scenario 20: Connect-Repo Without Push Access (stretch)
**Condition**: `POST /github/connect-repo` is called for a repository where `permissions.push` is `false` in the GitHub API response (user is a read-only collaborator or has no write rights)
**Response**: Backend returns HTTP 403 with body `{ "error": "You do not have write access to owner/repo. Push access is required to create secrets and workflow files." }`; no secret creation or file write is attempted
**Recovery**: Dashboard displays the error message and prompts the user to select a repository where they have push access; no files or secrets in the target repo are modified

---

## Testing Strategy

### Unit Testing Approach

Use **Vitest** (or Jest) for all unit tests. Target 80%+ line coverage on backend service modules.

Key unit test areas:
- `LogProcessor.truncate()`: empty string, under-limit log, over-limit log, ANSI-heavy log, log with no keyword matches
- `LLMClient.diagnose()`: valid JSON response, invalid JSON, missing fields, network timeout
- `validateWebhookRequest()`: missing header, wrong value, correct value, empty `WEBHOOK_SECRET`
- `ingestBuild()`: happy path, missing fields, database error
- `processJob()`: success on first attempt, success on retry, failure after both attempts

### Property-Based Testing Approach

Use **fast-check** for property-based tests on the log processing and parsing layers.

**Property Test Library**: fast-check

Properties to verify:
- `truncateLog(log)` result never exceeds `maxLines + 1` lines for any string input
- `truncateLog(log).cleanedLog` never contains ANSI sequences for any string input
- `isValidDiagnosisResult(parseJSON(buildSystemPrompt()))` — the prompt always produces parseable structure
- For any `log` with `length ≤ maxLines`, `truncated = false` always holds

### Integration Testing Approach

Use **Supertest** to test the full Express request/response cycle:
- POST `/webhook/ingest` with valid and invalid secrets
- POST `/simulate` with each scenario
- GET `/diagnoses` with pagination params
- GET `/diagnoses/:id` for existing and non-existing IDs
- End-to-end: simulate → poll → verify `status = "complete"` (using a mock LLM client)

---

## Performance Considerations

- **Webhook response time**: The ingestion handler must respond within ~2 seconds. All LLM work happens off the request path via the job queue.
- **Log truncation**: `truncateLog` is synchronous and O(n) in log line count. For worst-case 100k-line logs this is ~10 ms — acceptable.
- **Job queue throughput**: For an MVP solo project, a simple in-process queue with concurrency = 2 is sufficient. LLM calls take 3–10 seconds each; at 2 concurrent workers this handles burst load from demos.
- **Database**: SQLite with WAL mode handles concurrent reads well. The index on `created_at DESC` ensures the dashboard list query stays fast up to tens of thousands of records.
- **Frontend polling**: 3-second poll interval is a good MVP tradeoff. Can be replaced with Server-Sent Events post-hackathon.
- **Diagnosis SLA**: Each job must reach a terminal status within 120 seconds of being dequeued. A watchdog (timeout wrapper around the full `processJob` execution) enforces this bound and forces `status = "unavailable"` on expiry, ensuring the dashboard never shows a permanently spinning "pending" record (Req 3.5).

---

## Deployment Considerations

### Startup Validation

On server start, before binding to any port or accepting requests, the Backend checks that both `WEBHOOK_SECRET` and `LLM_API_KEY` are set and non-empty. If either variable is missing, the server logs a clear error identifying the missing variable and calls `process.exit(1)` rather than starting in a degraded state (Req 11.2):

```typescript
const REQUIRED_ENV = ["WEBHOOK_SECRET", "LLM_API_KEY"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[startup] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
```

This prevents the server from silently accepting webhook requests and returning 500 due to a missing `WEBHOOK_SECRET`, or silently failing every diagnosis job due to a missing `LLM_API_KEY`. The runtime `validateWebhookRequest` 500-path (Edit 6) is a defense-in-depth fallback for the case where the env var is unset at runtime despite passing the startup check (e.g., hot-reload or env mutation).

### Free-Tier Cold Start Mitigation

Free-tier hosts (Render, Railway) spin down idle instances after ~15 minutes of inactivity. The first request after a cold start can take 30–60 seconds, which appears broken to a judge trying to demo the app.

**Mitigation**: A lightweight `GET /health` endpoint (returns `200 { status: "ok" }`) should be exposed and pinged every 10 minutes by an external uptime service (e.g. UptimeRobot free tier, cron-job.org) or a scheduled GitHub Actions workflow. This is especially important during the judging window.

### CI Trigger Snippets

These show the sender-side configuration that fires the webhook on a CI failure. The backend's `/webhook/ingest` endpoint is the receiver for both.

#### GitHub Actions

```yaml
# Add this step to any workflow job, after your build/test steps:
- name: Notify CI/CD Failure Doctor
  if: failure()
  run: |
    curl -s -X POST "${{ secrets.CICD_DOCTOR_URL }}/webhook/ingest" \
      -H "Content-Type: application/json" \
      -H "X-Webhook-Secret: ${{ secrets.CICD_DOCTOR_SECRET }}" \
      -d '{
        "log":       "'"$(cat build.log | tail -300)"'",
        "repoName":  "${{ github.repository }}",
        "jobName":   "${{ github.workflow }} / ${{ github.job }}",
        "commitSha": "${{ github.sha }}",
        "source":    "github",
        "branch":    "${{ github.ref_name }}"
      }'
```

#### Jenkins (Declarative Pipeline)

```groovy
post {
  failure {
    script {
      def log = currentBuild.rawBuild.getLog(300).join('\n')
      httpRequest(
        httpMode:        'POST',
        url:             "${env.CICD_DOCTOR_URL}/webhook/ingest",
        contentType:     'APPLICATION_JSON',
        customHeaders:   [[name: 'X-Webhook-Secret', value: env.CICD_DOCTOR_SECRET]],
        requestBody:     groovy.json.JsonOutput.toJson([
          log:       log,
          repoName:  env.JOB_NAME,
          jobName:   env.JOB_NAME,
          commitSha: env.GIT_COMMIT,
          source:    'jenkins'
        ])
      )
    }
  }
}
```

---

## Security Considerations

- **Webhook secret**: Compared with `crypto.timingSafeEqual` to prevent timing attacks. Documented in deployment README.
- **Log content**: Raw logs may contain secrets (env vars printed in error output). The application stores them in SQLite and displays them in the UI. For MVP, acceptable; production hardening would require log scrubbing.
- **LLM prompt injection**: The system prompt instructs the LLM to return only JSON. Log content is injected as a user message, not interpolated into the system prompt, reducing prompt injection risk.
- **Input size**: Maximum raw log size accepted via webhook is capped at 10 MB in the Express body parser config to prevent DoS.
- **WEBHOOK_SECRET** and **LLM_API_KEY** must be set as environment variables, never hardcoded.
- **CORS**: The frontend (Vercel) and backend (Render/Railway) run on different origins. Express must be configured with the `cors` package to explicitly allow the deployed frontend origin (e.g. `https://cicd-doctor.vercel.app`) and `http://localhost:5173` for local dev. A wildcard (`*`) must not be used, as it would allow any origin to POST to the webhook endpoint.
- **Rate limiting**: `/webhook/ingest` and `/simulate` are publicly reachable and can trigger LLM API calls. Per-IP rate limiting via `express-rate-limit` (e.g. 20 requests/minute per IP) must be applied to both endpoints to prevent quota exhaustion and abuse during the judging window.

---

## Dependencies

### Backend
| Package | Purpose |
|---|---|
| `express` | HTTP server and routing |
| `better-sqlite3` | SQLite ORM-free client (sync API, simpler for MVP) |
| `uuid` | UUID v4 generation |
| `p-queue` | In-process async job queue with concurrency control |
| `openai` | LLM API client (compatible with OpenAI and OpenAI-compatible endpoints) |
| `zod` | Runtime schema validation for LLM responses and webhook payloads |
| `strip-ansi` | Remove ANSI escape codes from log strings |
| `cors` | CORS middleware — restrict cross-origin requests to known frontend origins |
| `express-rate-limit` | Per-IP rate limiting on `/webhook/ingest` and `/simulate` |
| `nodemailer` | SMTP email sending for the stretch notification feature |
| `@octokit/rest` | GitHub API client for auto-fix PR creation (stretch) |

### Frontend
| Package | Purpose |
|---|---|
| `react` + `react-dom` | UI framework |
| `react-markdown` | Render `suggestedFix` markdown safely |
| `vite` | Build tool and dev server |

### Dev / Testing
| Package | Purpose |
|---|---|
| `vitest` | Test runner |
| `supertest` | HTTP integration test client |
| `fast-check` | Property-based testing |
| `typescript` | Type safety across the stack |

---

## Environment Variables

Complete reference for all environment variables used across the system. Copy this block to create a `.env` file for local development.

```env
# ── Required ──────────────────────────────────────────────────────────────────
WEBHOOK_SECRET=changeme          # Shared secret validated on every /webhook/ingest request
LLM_API_KEY=sk-...               # API key for the configured LLM provider

# ── LLM Configuration ─────────────────────────────────────────────────────────
LLM_MODEL=gpt-4o-mini            # Model name passed to the LLM API (default: gpt-4o-mini)

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_PATH=./data/cicd-doctor.db   # SQLite file path (default shown)

# ── Server ────────────────────────────────────────────────────────────────────
PORT=3000                        # Express listen port (default: 3000)

# ── Stretch: Notifications (optional) ─────────────────────────────────────────
SLACK_WEBHOOK_URL=               # If set, POST diagnosis summary to this Slack Incoming Webhook URL
NOTIFICATION_EMAIL=              # If set, send diagnosis summary email to this address
APP_BASE_URL=http://localhost:3000  # Base URL used to construct diagnosis detail links in notifications

# ── Stretch: Auto-Fix Pull Requests (optional) ────────────────────────────────
GITHUB_TOKEN=                    # GitHub personal access token with 'repo' scope; required for auto-fix PR creation
GITHUB_REPO=                     # Target repository in 'owner/repo' format (e.g., 'acme/payments-service')

# ── Stretch: GitHub OAuth Connection (optional) ───────────────────────────────────────────
GITHUB_CLIENT_ID=                # GitHub OAuth App Client ID; if unset, the "Connect GitHub" button is hidden and all OAuth routes are disabled
GITHUB_CLIENT_SECRET=            # GitHub OAuth App Client Secret; if unset, the "Connect GitHub" button is hidden and all OAuth routes are disabled
GITHUB_REDIRECT_URI=             # OAuth callback URL (default: {APP_BASE_URL}/auth/github/callback); must match the callback URL registered in your GitHub OAuth App settings
TOKEN_ENCRYPTION_KEY=            # 32-byte hex string used to encrypt stored GitHub OAuth access tokens; if unset, a random key is generated on startup (tokens will not persist across restarts)

# ── Stretch: CORS ─────────────────────────────────────────────────────────────
# Configure the allowed frontend origin in your Express cors() config:
# cors({ origin: ['https://your-app.vercel.app', 'http://localhost:5173'] })
```
