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
export interface GitHubRepo {
    name: string;
    full_name: string;
    default_branch: string;
    html_url: string;
}
/** Returned by `connectRepo` on complete success. */
export interface ConnectRepoSuccess {
    success: true;
    repoFullName: string;
    workflowUrl: string;
}
/**
 * Returned by `connectRepo` when secrets were created but the workflow file
 * write failed (maps to HTTP 207 in the route layer).
 *
 * Requirements: 17.9
 */
export interface ConnectRepoPartial {
    secretsCreated: true;
    workflowCreated: false;
    error: string;
    manualSetupUrl: string;
}
export type ConnectRepoResult = ConnectRepoSuccess | ConnectRepoPartial;
/**
 * Thrown when the GitHub API returns HTTP 401 (token invalid / expired).
 *
 * Requirements: 17.7
 */
export declare class GitHubAuthError extends Error {
    constructor(message: string);
}
/**
 * Thrown when the GitHub API returns HTTP 403 with X-RateLimit-Remaining: 0.
 *
 * `resetTimestamp` is the raw value from the X-RateLimit-Reset header
 * (Unix epoch seconds as a string), or null if the header was absent.
 *
 * Requirements: 17.15
 */
export declare class GitHubRateLimitError extends Error {
    readonly resetTimestamp: string | null;
    constructor(message: string, resetTimestamp: string | null);
}
/**
 * Thrown when the GitHub API returns HTTP 403 without a rate-limit header
 * (insufficient repository permissions or Actions disabled).
 *
 * Requirements: 17.10
 */
export declare class GitHubPermissionError extends Error {
    constructor(message: string);
}
/**
 * Returns true when both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set
 * to non-empty values — i.e. the OAuth feature is fully configured.
 *
 * Requirements: 17.1, 17.2
 */
export declare function isOAuthEnabled(): boolean;
/**
 * Constructs the GitHub OAuth authorization URL that the user should be
 * redirected to in order to begin the OAuth flow.
 *
 * The caller is responsible for generating `state` (a cryptographically
 * random value) and storing it in the session before redirecting.
 *
 * Requirements: 17.3
 */
export declare function getLoginUrl(state: string): string;
/**
 * Exchanges an OAuth authorization code for a GitHub access token.
 *
 * POSTs to GitHub's token endpoint with the client credentials and the
 * provided code + redirect URI.  Throws if the exchange fails or GitHub
 * returns an error field in the response body.
 *
 * Requirements: 17.4
 */
export declare function exchangeCode(code: string, redirectUri: string): Promise<string>;
/**
 * Retrieves the authenticated user's GitHub username (the `login` field).
 *
 * This call is best-effort: any error is caught and logged, and null is
 * returned without throwing so the OAuth flow is never blocked.
 *
 * Requirements: 17.19
 */
export declare function fetchGitHubUsername(accessToken: string): Promise<string | null>;
/**
 * Fetches the list of repositories where the authenticated user has push
 * access (owner, collaborator with push, or admin).
 *
 * Filters the GitHub API response to only include repositories where
 * `permissions.push` is true.
 *
 * Requirements: 17.6
 */
export declare function listRepos(accessToken: string): Promise<GitHubRepo[]>;
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
export declare function connectRepo(accessToken: string, repoFullName: string, webhookSecret?: string): Promise<ConnectRepoResult>;
//# sourceMappingURL=githubConnection.d.ts.map