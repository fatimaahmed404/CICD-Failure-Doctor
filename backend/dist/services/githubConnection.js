"use strict";
/**
 * GitHubConnectionService — low-level OAuth and repo-connection helpers.
 *
 * This module contains pure functions that operate directly on access tokens.
 * It has no knowledge of the database or encryption layers; callers are
 * responsible for token storage, retrieval, and decryption.
 *
 * Design decision: keeping token storage out of this module makes every
 * function unit-testable without a database.
 *
 * Uses the standard OAuth App model — NOT the GitHub App installation flow.
 *
 * Requirements: 17.3, 17.6, 17.8, 17.9, 17.10, 17.15, 17.16
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubPermissionError = exports.GitHubRateLimitError = exports.GitHubAuthError = void 0;
exports.isOAuthEnabled = isOAuthEnabled;
exports.getLoginUrl = getLoginUrl;
exports.exchangeCode = exchangeCode;
exports.fetchGitHubUsername = fetchGitHubUsername;
exports.listRepos = listRepos;
exports.connectRepo = connectRepo;
// ── Typed error classes ───────────────────────────────────────────────────────
/**
 * Thrown when the GitHub API returns HTTP 401 (token invalid / expired).
 *
 * Requirements: 17.7
 */
class GitHubAuthError extends Error {
    constructor(message) {
        super(message);
        this.name = "GitHubAuthError";
    }
}
exports.GitHubAuthError = GitHubAuthError;
/**
 * Thrown when the GitHub API returns HTTP 403 with X-RateLimit-Remaining: 0.
 *
 * `resetTimestamp` is the raw value from the X-RateLimit-Reset header
 * (Unix epoch seconds as a string), or null if the header was absent.
 *
 * Requirements: 17.15
 */
class GitHubRateLimitError extends Error {
    resetTimestamp;
    constructor(message, resetTimestamp) {
        super(message);
        this.resetTimestamp = resetTimestamp;
        this.name = "GitHubRateLimitError";
    }
}
exports.GitHubRateLimitError = GitHubRateLimitError;
/**
 * Thrown when the GitHub API returns HTTP 403 without a rate-limit header
 * (insufficient repository permissions or Actions disabled).
 *
 * Requirements: 17.10
 */
class GitHubPermissionError extends Error {
    constructor(message) {
        super(message);
        this.name = "GitHubPermissionError";
    }
}
exports.GitHubPermissionError = GitHubPermissionError;
// ── Internal helpers ──────────────────────────────────────────────────────────
/**
 * Shared response-error handler for GitHub API calls.
 * Must be called only for non-ok responses.
 *
 * Precedence:
 *  1. 401                                  → GitHubAuthError
 *  2. 403 + X-RateLimit-Remaining: "0"     → GitHubRateLimitError
 *  3. 403 (any other reason)               → GitHubPermissionError
 *  4. Everything else                      → generic Error
 */
function throwForGitHubError(res, context) {
    const prefix = context ? `[${context}] ` : "";
    if (res.status === 401) {
        throw new GitHubAuthError(`${prefix}GitHub token is no longer valid. Please reconnect your account.`);
    }
    if (res.status === 403) {
        const remaining = res.headers.get("X-RateLimit-Remaining");
        if (remaining === "0") {
            const reset = res.headers.get("X-RateLimit-Reset");
            throw new GitHubRateLimitError(`${prefix}GitHub API rate limit exceeded.`, reset);
        }
        throw new GitHubPermissionError(`${prefix}Insufficient permissions. Push access is required.`);
    }
    throw new Error(`${prefix}GitHub API error: HTTP ${res.status}`);
}
/** Common headers for authenticated GitHub API requests. */
function githubHeaders(accessToken) {
    return {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
}
function getRedirectUri() {
    if (process.env.GITHUB_REDIRECT_URI)
        return process.env.GITHUB_REDIRECT_URI;
    const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
    return `${base}/auth/github/callback`;
}
// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Returns true when both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set
 * to non-empty values — i.e. the OAuth feature is fully configured.
 *
 * Requirements: 17.1, 17.2
 */
function isOAuthEnabled() {
    const id = process.env.GITHUB_CLIENT_ID;
    const secret = process.env.GITHUB_CLIENT_SECRET;
    return Boolean(id && id.trim() !== "" && secret && secret.trim() !== "");
}
/**
 * Constructs the GitHub OAuth authorization URL that the user should be
 * redirected to in order to begin the OAuth flow.
 *
 * The caller is responsible for generating `state` (a cryptographically
 * random value) and storing it in the session before redirecting.
 *
 * Requirements: 17.3
 */
function getLoginUrl(state) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const redirectUri = getRedirectUri();
    const params = new URLSearchParams({
        client_id: clientId,
        scope: "repo workflow",
        redirect_uri: redirectUri,
        state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
}
/**
 * Exchanges an OAuth authorization code for a GitHub access token.
 *
 * POSTs to GitHub's token endpoint with the client credentials and the
 * provided code + redirect URI.  Throws if the exchange fails or GitHub
 * returns an error field in the response body.
 *
 * Requirements: 17.4
 */
async function exchangeCode(code, redirectUri) {
    const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: redirectUri,
        }),
    });
    if (!res.ok) {
        throw new Error(`GitHub token exchange request failed: HTTP ${res.status}`);
    }
    const data = (await res.json());
    if (data.error || !data.access_token) {
        throw new Error(data.error_description ?? data.error ?? "Token exchange failed: no access_token in response");
    }
    return data.access_token;
}
/**
 * Retrieves the authenticated user's GitHub username (the `login` field).
 *
 * This call is best-effort: any error is caught and logged, and null is
 * returned without throwing so the OAuth flow is never blocked.
 *
 * Requirements: 17.19
 */
async function fetchGitHubUsername(accessToken) {
    try {
        const res = await fetch("https://api.github.com/user", {
            headers: githubHeaders(accessToken),
        });
        if (!res.ok) {
            console.warn(`[githubConnection] fetchGitHubUsername: HTTP ${res.status}`);
            return null;
        }
        const data = (await res.json());
        return data.login ?? null;
    }
    catch (err) {
        console.warn("[githubConnection] fetchGitHubUsername error:", err);
        return null;
    }
}
/**
 * Fetches the list of repositories where the authenticated user has push
 * access (owner, collaborator with push, or admin).
 *
 * Filters the GitHub API response to only include repositories where
 * `permissions.push` is true.
 *
 * Requirements: 17.6
 */
async function listRepos(accessToken) {
    const res = await fetch("https://api.github.com/user/repos?affiliation=owner,collaborator&sort=updated&per_page=100", { headers: githubHeaders(accessToken) });
    if (!res.ok) {
        throwForGitHubError(res, "listRepos");
    }
    const repos = (await res.json());
    return repos
        .filter((r) => r.permissions?.push === true || r.permissions?.admin === true)
        .map((r) => ({
        name: r.name,
        full_name: r.full_name,
        default_branch: r.default_branch,
        html_url: r.html_url,
    }));
}
/**
 * Connects a repository by:
 *  1. Fetching the repo's Actions public key (for libsodium secret encryption)
 *  2. Encrypting WEBHOOK_SECRET and APP_BASE_URL using libsodium sealed box
 *  3. Creating/updating the CICD_DOCTOR_SECRET repository secret
 *  4. Creating/updating the CICD_DOCTOR_URL repository secret
 *  5. Creating/updating the workflow file at
 *     `.github/workflows/cicd-failure-doctor.yml`
 *
 * Returns:
 *  - `ConnectRepoSuccess`  when all five steps complete successfully
 *  - `ConnectRepoPartial`  when steps 1–4 succeed but step 5 fails
 *    (caller should return HTTP 207 — do NOT roll back the secrets)
 *
 * Throws `GitHubAuthError`, `GitHubRateLimitError`, or `GitHubPermissionError`
 * when steps 1–4 encounter an API error.
 *
 * Only modifies: CICD_DOCTOR_SECRET, CICD_DOCTOR_URL,
 *                .github/workflows/cicd-failure-doctor.yml
 * Never touches any other file, secret, branch, or setting.
 *
 * Requirements: 17.8, 17.9, 17.10, 17.14
 */
async function connectRepo(accessToken, repoFullName, webhookSecret) {
    const parts = repoFullName.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error("Invalid repoFullName: expected 'owner/repo' format");
    }
    const [owner, repo] = parts;
    // ── Step 1: Fetch the repo's Actions public key ───────────────────────────
    const pkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`, { headers: githubHeaders(accessToken) });
    if (!pkRes.ok) {
        throwForGitHubError(pkRes, "connectRepo/public-key");
    }
    const { key: repoPublicKey, key_id: keyId } = (await pkRes.json());
    // ── Step 2: Encrypt secrets with libsodium sealed box ────────────────────
    //
    // GitHub requires sealed-box encryption with the repo's Curve25519 public key.
    // We use require() + .default here because tsc compiles top-level ES imports to
    // __importDefault/__importStar which snapshot the module object BEFORE sodium.ready
    // resolves — leaving all crypto functions undefined at call time.
    // require() returns the live object; accessing .default after awaiting .ready
    // guarantees crypto_box_seal and friends are populated.
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
    const _sodiumMod = require("libsodium-wrappers");
    await _sodiumMod.ready;
    const sodium = _sodiumMod.default ?? _sodiumMod;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
    function sealSecret(plaintext) {
        const keyBytes = sodium.from_base64(repoPublicKey, sodium.base64_variants.ORIGINAL);
        const msgBytes = sodium.from_string(plaintext);
        const encrypted = sodium.crypto_box_seal(msgBytes, keyBytes);
        return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
    }
    const secretToStore = webhookSecret ?? process.env.WEBHOOK_SECRET ?? "";
    const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const encryptedWebhookSecret = sealSecret(secretToStore);
    const encryptedAppBaseUrl = sealSecret(appBaseUrl);
    // ── Step 3: Create/update CICD_DOCTOR_SECRET ─────────────────────────────
    const secretHeaders = {
        ...githubHeaders(accessToken),
        "Content-Type": "application/json",
    };
    const secretRes1 = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/CICD_DOCTOR_SECRET`, {
        method: "PUT",
        headers: secretHeaders,
        body: JSON.stringify({ encrypted_value: encryptedWebhookSecret, key_id: keyId }),
    });
    if (!secretRes1.ok) {
        // Map 403/401 to typed errors; anything else is a generic secret-creation error
        if (secretRes1.status === 401 || secretRes1.status === 403) {
            throwForGitHubError(secretRes1, "connectRepo/CICD_DOCTOR_SECRET");
        }
        throw new Error(`Failed to create CICD_DOCTOR_SECRET: HTTP ${secretRes1.status}`);
    }
    // ── Step 4: Create/update CICD_DOCTOR_URL ────────────────────────────────
    const secretRes2 = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/CICD_DOCTOR_URL`, {
        method: "PUT",
        headers: secretHeaders,
        body: JSON.stringify({ encrypted_value: encryptedAppBaseUrl, key_id: keyId }),
    });
    if (!secretRes2.ok) {
        if (secretRes2.status === 401 || secretRes2.status === 403) {
            throwForGitHubError(secretRes2, "connectRepo/CICD_DOCTOR_URL");
        }
        throw new Error(`Failed to create CICD_DOCTOR_URL: HTTP ${secretRes2.status}`);
    }
    // ── Step 5: Create/update the workflow file ───────────────────────────────
    //
    // Secrets were successfully created.  From here on, any failure becomes a
    // ConnectRepoPartial result (HTTP 207) rather than an exception, so the
    // caller can inform the user that secrets are in place but the file needs
    // manual addition.  We do NOT roll back the secrets (Req 17.9).
    const workflowPath = ".github/workflows/cicd-failure-doctor.yml";
    const workflowContent = buildWorkflowYaml();
    const workflowBase64 = Buffer.from(workflowContent, "utf8").toString("base64");
    const frontendUrl = process.env.FRONTEND_URL?.trim() || appBaseUrl;
    const manualSetupUrl = `${frontendUrl}/#manual-setup`;
    try {
        // Check for an existing file to get its SHA (required for updates).
        let existingSha;
        try {
            const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`, { headers: githubHeaders(accessToken) });
            if (checkRes.ok) {
                const existing = (await checkRes.json());
                existingSha = existing.sha;
            }
        }
        catch {
            // Non-fatal — proceed without SHA; GitHub will treat it as a create.
        }
        const workflowRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`, {
            method: "PUT",
            headers: { ...githubHeaders(accessToken), "Content-Type": "application/json" },
            body: JSON.stringify({
                message: "ci: add CI/CD Failure Doctor notification workflow",
                content: workflowBase64,
                ...(existingSha ? { sha: existingSha } : {}),
            }),
        });
        if (!workflowRes.ok) {
            const errText = await workflowRes.text().catch(() => "unknown error");
            return {
                secretsCreated: true,
                workflowCreated: false,
                error: `Workflow file creation failed (HTTP ${workflowRes.status}): ${errText}`,
                manualSetupUrl,
            };
        }
        const workflowData = (await workflowRes.json());
        const workflowUrl = workflowData?.content?.html_url ??
            `https://github.com/${owner}/${repo}/blob/HEAD/${workflowPath}`;
        return { success: true, repoFullName, workflowUrl };
    }
    catch (err) {
        // Network or parse error during workflow step — report partial success.
        const message = err instanceof Error ? err.message : String(err);
        return {
            secretsCreated: true,
            workflowCreated: false,
            error: `Workflow file creation encountered an unexpected error: ${message}`,
            manualSetupUrl,
        };
    }
}
// ── Workflow YAML template ────────────────────────────────────────────────────
/**
 * Generates the CI/CD Failure Doctor GitHub Actions workflow file content.
 *
 * The generated YAML is identical in structure to the CI Trigger Snippet in
 * design.md, adapted to reference the two named repository secrets
 * (CICD_DOCTOR_SECRET and CICD_DOCTOR_URL) that were just created.
 *
 * Requirements: 17.8, 17.14
 */
function buildWorkflowYaml() {
    // NOTE: Each ${{ }} must be escaped as \${{ }} inside a TypeScript template literal.
    return `# CI/CD Failure Doctor — auto-generated workflow
# Triggered when any workflow in this repo fails.
# Secrets CICD_DOCTOR_SECRET and CICD_DOCTOR_URL were configured automatically.
name: Notify CI/CD Failure Doctor on Failure

on:
  workflow_run:
    workflows: ["*"]
    types: [completed]

jobs:
  notify:
    if: \${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
    steps:
      - name: Send logs to CI/CD Failure Doctor
        run: |
          # Download run logs using the GitHub REST API (no extra tools needed)
          LOGS=$(curl -s \
            -H "Authorization: Bearer \${{ github.token }}" \
            -H "Accept: application/vnd.github+json" \
            "https://api.github.com/repos/\${{ github.repository }}/actions/runs/\${{ github.event.workflow_run.id }}/logs" \
            -L -o /tmp/run_logs.zip 2>&1 \
            && unzip -p /tmp/run_logs.zip 2>/dev/null | tail -c 15000 || echo "Log unavailable")

          # Build JSON with jq so special characters are safely escaped
          PAYLOAD=$(jq -nc \
            --arg log    "$LOGS" \
            --arg repo   "\${{ github.repository }}" \
            --arg job    "\${{ github.event.workflow_run.name }}" \
            --arg sha    "\${{ github.event.workflow_run.head_sha }}" \
            --arg branch "\${{ github.event.workflow_run.head_branch }}" \
            '{log:$log,repoName:$repo,jobName:$job,commitSha:$sha,source:"github",branch:$branch}')

          curl -sf -X POST "\${{ secrets.CICD_DOCTOR_URL }}/webhook/ingest" \
            -H "Content-Type: application/json" \
            -H "X-Webhook-Secret: \${{ secrets.CICD_DOCTOR_SECRET }}" \
            -d "$PAYLOAD" && echo "Notification sent" || echo "Notification failed (non-fatal)"
`;
}
//# sourceMappingURL=githubConnection.js.map