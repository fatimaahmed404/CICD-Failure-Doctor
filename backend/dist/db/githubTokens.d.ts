/**
 * Data-access functions for the github_tokens table.
 *
 * Requirements: 17.18, 18.9
 */
export interface GitHubTokenRow {
    client_id: string;
    encrypted_token: string;
    github_username: string | null;
    created_at: string;
    user_id: string | null;
}
export interface GitHubTokenRecord {
    clientId: string;
    encryptedToken: string;
    githubUsername: string | null;
    createdAt: Date;
    userId: string | null;
}
export declare function upsertGitHubToken(clientId: string, encryptedToken: string, githubUsername: string | null, userId?: string | null): GitHubTokenRecord;
export declare function getGitHubToken(clientId: string): GitHubTokenRecord | null;
export declare function getGitHubTokenByUserId(userId: string): GitHubTokenRecord | null;
export declare function deleteGitHubToken(clientId: string): void;
export declare function deleteGitHubTokenByUserId(userId: string): void;
//# sourceMappingURL=githubTokens.d.ts.map