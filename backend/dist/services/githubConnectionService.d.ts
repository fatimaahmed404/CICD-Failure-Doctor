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
export interface GitHubRepo {
    name: string;
    full_name: string;
    default_branch: string;
    html_url: string;
}
export interface ConnectRepoResult {
    success: true;
    repoFullName: string;
    workflowUrl: string;
}
export interface ConnectRepoPartialResult {
    partialSuccess: true;
    repoFullName: string;
    secretsCreated: true;
    workflowError: string;
    manualSetupUrl: string;
}
export type OAuthStateStore = Map<string, string>;
/**
 * Generate a random state value, store it against the clientId, and return it.
 * Requirement: 17.3
 */
export declare function generateOAuthState(clientId: string): string;
/**
 * Validate that the returned state matches what we stored for this client.
 * Requirement: 17.4
 */
export declare function validateOAuthState(clientId: string, state: string): boolean;
/**
 * Build the GitHub OAuth authorization URL.
 * Requirement: 17.3
 */
export declare function buildAuthorizationUrl(clientId: string): string;
/**
 * Exchange an OAuth code for an access token and persist it (encrypted).
 * Also fetches the GitHub username (best-effort).
 *
 * Requirements: 17.4, 17.5, 17.19
 */
export declare function exchangeCodeForToken(code: string, clientId: string): Promise<{
    githubUsername: string | null;
}>;
/**
 * Look up and decrypt the stored access token for a client.
 * Returns null if no token is stored.
 */
export declare function getDecryptedToken(clientId: string): string | null;
/**
 * Fetch the list of repositories where the user has push access.
 * Requirement: 17.6
 */
export declare function listUserRepos(clientId: string): Promise<GitHubRepo[]>;
/**
 * Connects a repository by:
 *  1. Encrypting WEBHOOK_SECRET using the repo's public key (libsodium sealed box)
 *  2. Creating/updating CICD_DOCTOR_SECRET and CICD_DOCTOR_URL repo secrets
 *  3. Creating/updating the workflow file
 *
 * Requirements: 17.8, 17.9, 17.10, 17.14, 17.15
 */
export declare function connectRepository(clientId: string, repoFullName: string): Promise<ConnectRepoResult | ConnectRepoPartialResult>;
/**
 * Remove the stored token for a client.
 * Requirement: 17.20
 */
export declare function disconnectGitHub(clientId: string): void;
export declare class TokenNotFoundError extends Error {
    constructor(message: string);
}
export declare class InvalidTokenError extends Error {
    constructor(message: string);
}
export declare class InsufficientPermissionsError extends Error {
    constructor(message: string);
}
export declare class GitHubRateLimitError extends Error {
    readonly resetTimestamp: string | null;
    constructor(message: string, resetTimestamp: string | null);
}
/**
 * Centralised error handler for GitHub API responses.
 * Throws typed errors for 401, 403, 429.
 *
 * Requirements: 17.7, 17.15
 */
export declare function handleGitHubApiErrors(res: Response): void;
//# sourceMappingURL=githubConnectionService.d.ts.map