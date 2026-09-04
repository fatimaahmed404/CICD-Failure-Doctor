/**
 * Data-access functions for the github_tokens table.
 *
 * Stores and retrieves encrypted OAuth tokens associated with anonymous
 * client IDs.  The actual encryption/decryption is handled by
 * tokenEncryption.ts; this module only deals with persistence.
 *
 * Requirements: 17.18
 */
export interface GitHubTokenRow {
    client_id: string;
    encrypted_token: string;
    github_username: string | null;
    created_at: number;
}
export interface GitHubTokenRecord {
    clientId: string;
    encryptedToken: string;
    githubUsername: string | null;
    createdAt: Date;
}
/**
 * Upsert an encrypted token for the given clientId.
 * Updates github_username if provided.
 *
 * Requirement: 17.18
 */
export declare function upsertGitHubToken(clientId: string, encryptedToken: string, githubUsername: string | null): GitHubTokenRecord;
/**
 * Retrieve the token record for a client.
 * Returns null if no token is stored.
 *
 * Requirement: 17.6
 */
export declare function getGitHubToken(clientId: string): GitHubTokenRecord | null;
/**
 * Delete the token record for a client (disconnect flow).
 *
 * Requirement: 17.20
 */
export declare function deleteGitHubToken(clientId: string): void;
//# sourceMappingURL=githubTokens.d.ts.map