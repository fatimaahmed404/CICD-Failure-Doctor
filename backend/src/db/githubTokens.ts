/**
 * Data-access functions for the github_tokens table.
 *
 * Stores and retrieves encrypted OAuth tokens associated with anonymous
 * client IDs.  The actual encryption/decryption is handled by
 * tokenEncryption.ts; this module only deals with persistence.
 *
 * Requirements: 17.18
 */

import { db } from "./init.js";

export interface GitHubTokenRow {
  client_id: string;
  encrypted_token: string;
  github_username: string | null;
  created_at: string;
}

export interface GitHubTokenRecord {
  clientId: string;
  encryptedToken: string;
  githubUsername: string | null;
  createdAt: Date;
}

function rowToDomain(row: GitHubTokenRow): GitHubTokenRecord {
  return {
    clientId: row.client_id,
    encryptedToken: row.encrypted_token,
    githubUsername: row.github_username,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Upsert an encrypted token for the given clientId.
 * Updates github_username if provided.
 *
 * Requirement: 17.18
 */
export function upsertGitHubToken(
  clientId: string,
  encryptedToken: string,
  githubUsername: string | null,
): GitHubTokenRecord {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO github_tokens (client_id, encrypted_token, github_username, created_at)
    VALUES (@client_id, @encrypted_token, @github_username, @created_at)
    ON CONFLICT(client_id) DO UPDATE SET
      encrypted_token = excluded.encrypted_token,
      github_username = excluded.github_username,
      created_at      = excluded.created_at
  `).run({
    client_id: clientId,
    encrypted_token: encryptedToken,
    github_username: githubUsername,
    created_at: now,
  });

  const row = db
    .prepare<[string]>("SELECT * FROM github_tokens WHERE client_id = ?")
    .get(clientId) as GitHubTokenRow;
  return rowToDomain(row);
}

/**
 * Retrieve the token record for a client.
 * Returns null if no token is stored.
 *
 * Requirement: 17.6
 */
export function getGitHubToken(clientId: string): GitHubTokenRecord | null {
  const row = db
    .prepare<[string]>("SELECT * FROM github_tokens WHERE client_id = ?")
    .get(clientId) as GitHubTokenRow | undefined;
  return row ? rowToDomain(row) : null;
}

/**
 * Delete the token record for a client (disconnect flow).
 *
 * Requirement: 17.20
 */
export function deleteGitHubToken(clientId: string): void {
  db.prepare<[string]>("DELETE FROM github_tokens WHERE client_id = ?").run(clientId);
}
