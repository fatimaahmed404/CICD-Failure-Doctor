"use strict";
/**
 * GitHubConnectionService
 *
 * Handles the GitHub OAuth 2.0 authorization code flow and repository
 * connection (secret + workflow file creation).
 *
 * Uses the standard OAuth App model — NOT the GitHub App installation flow.
 *
 * Requirements: 17.3, 17.4, 17.6, 17.7, 17.8, 17.9, 17.10, 17.14, 17.15, 17.16, 17.19
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubRateLimitError = exports.InsufficientPermissionsError = exports.InvalidTokenError = exports.TokenNotFoundError = void 0;
exports.generateOAuthState = generateOAuthState;
exports.validateOAuthState = validateOAuthState;
exports.buildAuthorizationUrl = buildAuthorizationUrl;
exports.exchangeCodeForToken = exchangeCodeForToken;
exports.getDecryptedToken = getDecryptedToken;
exports.listUserRepos = listUserRepos;
exports.connectRepository = connectRepository;
exports.disconnectGitHub = disconnectGitHub;
exports.handleGitHubApiErrors = handleGitHubApiErrors;
const crypto_1 = __importDefault(require("crypto"));
const tokenEncryption_js_1 = require("./tokenEncryption.js");
const githubTokens_js_1 = require("../db/githubTokens.js");
// Module-level in-memory state store (keyed by client ID).
// For production you'd use the session; for this app the in-process map is fine.
const stateStore = new Map();
// ── OAuth helpers ─────────────────────────────────────────────────────────────
/**
 * Generate a random state value, store it against the clientId, and return it.
 * Requirement: 17.3
 */
function generateOAuthState(clientId) {
    const state = crypto_1.default.randomBytes(16).toString("hex");
    stateStore.set(clientId, state);
    return state;
}
/**
 * Validate that the returned state matches what we stored for this client.
 * Requirement: 17.4
 */
function validateOAuthState(clientId, state) {
    const stored = stateStore.get(clientId);
    stateStore.delete(clientId); // one-time use
    return stored !== undefined && stored === state;
}
/**
 * Build the GitHub OAuth authorization URL.
 * Requirement: 17.3
 */
function buildAuthorizationUrl(clientId) {
    const githubClientId = process.env.GITHUB_CLIENT_ID;
    const redirectUri = getRedirectUri();
    const state = generateOAuthState(clientId);
    const params = new URLSearchParams({
        client_id: githubClientId,
        scope: "repo",
        redirect_uri: redirectUri,
        state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
}
function getRedirectUri() {
    if (process.env.GITHUB_REDIRECT_URI)
        return process.env.GITHUB_REDIRECT_URI;
    const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
    return `${base}/auth/github/callback`;
}
// ── Token exchange ────────────────────────────────────────────────────────────
/**
 * Exchange an OAuth code for an access token and persist it (encrypted).
 * Also fetches the GitHub username (best-effort).
 *
 * Requirements: 17.4, 17.5, 17.19
 */
async function exchangeCodeForToken(code, clientId) {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: getRedirectUri(),
        }),
    });
    if (!tokenRes.ok) {
        throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);
    }
    const tokenData = (await tokenRes.json());
    if (tokenData.error || !tokenData.access_token) {
        throw new Error(tokenData.error_description ?? tokenData.error ?? "Token exchange failed");
    }
    const accessToken = tokenData.access_token;
    // Best-effort: fetch GitHub username (Req 17.19)
    let githubUsername = null;
    try {
        const userRes = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/vnd.github+json",
            },
        });
        if (userRes.ok) {
            const userData = (await userRes.json());
            githubUsername = userData.login ?? null;
        }
    }
    catch {
        // non-fatal — continue
    }
    // Encrypt and persist (Req 17.5)
    const encryptedToken = (0, tokenEncryption_js_1.encryptToken)(accessToken);
    (0, githubTokens_js_1.upsertGitHubToken)(clientId, encryptedToken, githubUsername);
    return { githubUsername };
}
// ── Retrieve and decrypt token ────────────────────────────────────────────────
/**
 * Look up and decrypt the stored access token for a client.
 * Returns null if no token is stored.
 */
function getDecryptedToken(clientId) {
    const record = (0, githubTokens_js_1.getGitHubToken)(clientId);
    if (!record)
        return null;
    try {
        return (0, tokenEncryption_js_1.decryptToken)(record.encryptedToken);
    }
    catch {
        return null;
    }
}
// ── List repositories ─────────────────────────────────────────────────────────
/**
 * Fetch the list of repositories where the user has push access.
 * Requirement: 17.6
 */
async function listUserRepos(clientId) {
    const token = getDecryptedToken(clientId);
    if (!token) {
        throw new TokenNotFoundError("No GitHub token found for this client");
    }
    const res = await fetch("https://api.github.com/user/repos?affiliation=owner,collaborator&sort=updated&per_page=100", {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
        },
    });
    handleGitHubApiErrors(res);
    const repos = (await res.json());
    // Filter to repos where user has push access
    return repos
        .filter((r) => r.permissions?.push === true || r.permissions?.admin === true)
        .map((r) => ({
        name: r.name,
        full_name: r.full_name,
        default_branch: r.default_branch,
        html_url: r.html_url,
    }));
}
// ── Connect repository ────────────────────────────────────────────────────────
/**
 * Connects a repository by:
 *  1. Encrypting WEBHOOK_SECRET using the repo's public key (libsodium sealed box)
 *  2. Creating/updating CICD_DOCTOR_SECRET and CICD_DOCTOR_URL repo secrets
 *  3. Creating/updating the workflow file
 *
 * Requirements: 17.8, 17.9, 17.10, 17.14, 17.15
 */
async function connectRepository(clientId, repoFullName) {
    const token = getDecryptedToken(clientId);
    if (!token) {
        throw new TokenNotFoundError("No GitHub token found for this client");
    }
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
        throw new Error("Invalid repoFullName format (expected owner/repo)");
    }
    // ── Step 1: Get repo public key ───────────────────────────────────────────
    const pkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
        },
    });
    if (!pkRes.ok) {
        if (pkRes.status === 403) {
            throw new InsufficientPermissionsError("You do not have push access to this repository");
        }
        handleGitHubApiErrors(pkRes);
    }
    const { key, key_id } = (await pkRes.json());
    // ── Step 2: Encrypt secrets with libsodium sealed box ────────────────────
    const sodium = await Promise.resolve().then(() => __importStar(require("libsodium-wrappers")));
    await sodium.ready;
    function sealSecret(secretValue) {
        const binKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
        const binValue = Buffer.from(secretValue, "utf8");
        const encryptedBytes = sodium.crypto_box_seal(binValue, binKey);
        return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
    }
    const webhookSecret = process.env.WEBHOOK_SECRET ?? "";
    const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const encryptedWebhookSecret = sealSecret(webhookSecret);
    const encryptedAppBaseUrl = sealSecret(appBaseUrl);
    // ── Step 3: Create/update CICD_DOCTOR_SECRET ─────────────────────────────
    const secretRes1 = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/CICD_DOCTOR_SECRET`, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            encrypted_value: encryptedWebhookSecret,
            key_id,
        }),
    });
    if (!secretRes1.ok) {
        handleSecretError(secretRes1);
    }
    // ── Step 4: Create/update CICD_DOCTOR_URL ────────────────────────────────
    const secretRes2 = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/CICD_DOCTOR_URL`, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            encrypted_value: encryptedAppBaseUrl,
            key_id,
        }),
    });
    if (!secretRes2.ok) {
        handleSecretError(secretRes2);
    }
    // ── Step 5: Create/update workflow file ───────────────────────────────────
    const workflowContent = buildWorkflowContent();
    const workflowBase64 = Buffer.from(workflowContent, "utf8").toString("base64");
    const workflowPath = ".github/workflows/cicd-failure-doctor.yml";
    // Check if file already exists so we can pass its SHA (required for updates)
    let existingSha;
    try {
        const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        });
        if (checkRes.ok) {
            const existing = (await checkRes.json());
            existingSha = existing.sha;
        }
    }
    catch {
        // Non-fatal — if this fails we'll try to create fresh
    }
    const workflowRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            message: "ci: add CI/CD Failure Doctor notification workflow",
            content: workflowBase64,
            ...(existingSha ? { sha: existingSha } : {}),
        }),
    });
    if (!workflowRes.ok) {
        // Req 17.9: secrets succeeded but workflow failed → 207
        const errText = await workflowRes.text().catch(() => "Unknown error");
        return {
            partialSuccess: true,
            repoFullName,
            secretsCreated: true,
            workflowError: `Workflow file creation failed (${workflowRes.status}): ${errText}`,
            manualSetupUrl: "https://github.com/your-org/cicd-failure-doctor#manual-setup",
        };
    }
    const workflowData = (await workflowRes.json());
    const workflowUrl = workflowData?.content?.html_url ??
        `https://github.com/${owner}/${repo}/blob/${owner}/.github/workflows/cicd-failure-doctor.yml`;
    return { success: true, repoFullName, workflowUrl };
}
// ── Disconnect ────────────────────────────────────────────────────────────────
/**
 * Remove the stored token for a client.
 * Requirement: 17.20
 */
function disconnectGitHub(clientId) {
    (0, githubTokens_js_1.deleteGitHubToken)(clientId);
}
// ── Workflow file template ────────────────────────────────────────────────────
function buildWorkflowContent() {
    return `# CI/CD Failure Doctor — auto-generated workflow
# Sends failed build logs to your CI/CD Failure Doctor instance.
name: Notify CI/CD Failure Doctor

on:
  workflow_run:
    workflows: ["*"]
    types: [completed]

jobs:
  notify-failure-doctor:
    if: \${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    steps:
      - name: Send failure log to CI/CD Failure Doctor
        run: |
          LOG_URL="\${{ github.event.workflow_run.logs_url }}"
          curl -s -H "Authorization: Bearer \${{ secrets.GITHUB_TOKEN }}" \\
               -H "Accept: application/vnd.github+json" \\
               "\${LOG_URL}" -o run_logs.zip || true
          # Use workflow URL as placeholder log if direct download not available
          LOG_CONTENT=\$(cat run_logs.zip 2>/dev/null | head -c 500000 || echo "Log unavailable")
          curl -s -X POST "\${{ secrets.CICD_DOCTOR_URL }}/webhook/ingest" \\
               -H "Content-Type: application/json" \\
               -H "X-Webhook-Secret: \${{ secrets.CICD_DOCTOR_SECRET }}" \\
               -d "{
                 \\"log\\": \\"$(echo \\"$LOG_CONTENT\\" | head -c 100000 | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' | tr -d '\\n' || echo \\"Log unavailable\\")\\",
                 \\"repoName\\": \\"\${{ github.repository }}\\",
                 \\"jobName\\": \\"\${{ github.event.workflow_run.name }}\\",
                 \\"commitSha\\": \\"\${{ github.event.workflow_run.head_sha }}\\",
                 \\"source\\": \\"github\\",
                 \\"branch\\": \\"\${{ github.event.workflow_run.head_branch }}\\"
               }"
`;
}
// ── Error helpers ─────────────────────────────────────────────────────────────
class TokenNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = "TokenNotFoundError";
    }
}
exports.TokenNotFoundError = TokenNotFoundError;
class InvalidTokenError extends Error {
    constructor(message) {
        super(message);
        this.name = "InvalidTokenError";
    }
}
exports.InvalidTokenError = InvalidTokenError;
class InsufficientPermissionsError extends Error {
    constructor(message) {
        super(message);
        this.name = "InsufficientPermissionsError";
    }
}
exports.InsufficientPermissionsError = InsufficientPermissionsError;
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
 * Centralised error handler for GitHub API responses.
 * Throws typed errors for 401, 403, 429.
 *
 * Requirements: 17.7, 17.15
 */
function handleGitHubApiErrors(res) {
    if (res.ok)
        return;
    // Req 17.15: rate limit
    if (res.status === 403 &&
        res.headers.get("X-RateLimit-Remaining") === "0") {
        const reset = res.headers.get("X-RateLimit-Reset");
        throw new GitHubRateLimitError("GitHub API rate limit reached", reset);
    }
    // Req 17.7: invalid/expired token
    if (res.status === 401 || res.status === 403) {
        throw new InvalidTokenError("GitHub token is no longer valid. Please reconnect your account.");
    }
}
function handleSecretError(res) {
    if (res.ok)
        return;
    if (res.status === 403) {
        throw new InsufficientPermissionsError("You do not have permission to create secrets in this repository");
    }
    if (res.status === 404) {
        throw new Error("Repository not found or Actions not enabled");
    }
    handleGitHubApiErrors(res);
    throw new Error(`Secret creation failed: ${res.status}`);
}
//# sourceMappingURL=githubConnectionService.js.map