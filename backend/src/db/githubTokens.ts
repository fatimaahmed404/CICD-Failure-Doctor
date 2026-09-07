/**
 * Data-access functions for the github_tokens table.
 *
 * Requirements: 17.18, 18.9
 */

import { db } from "./init.js";

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

function rowToDomain(row: GitHubTokenRow): GitHubTokenRecord {
  return {
    clientId: row.client_id,
    encryptedToken: row.encrypted_token,
    githubUsername: row.github_username,
    createdAt: new Date(row.created_at),
    userId: row.user_id ?? null,
  };
}

export function upsertGitHubToken(
  clientId: string,
  encryptedToken: string,
  githubUsername: string | null,
  userId?: string | null,
): GitHubTokenRecord {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO github_tokens (client_id, encrypted_token, github_username, created_at, user_id)
    VALUES (@client_id, @encrypted_token, @github_username, @created_at, @user_id)
    ON CONFLICT(client_id) DO UPDATE SET
      encrypted_token = excluded.encrypted_token,
      github_username = excluded.github_username,
      created_at      = excluded.created_at,
      user_id         = excluded.user_id
  `).run({
    client_id: clientId,
    encrypted_token: encryptedToken,
    github_username: githubUsername,
    created_at: now,
    user_id: userId ?? null,
  });

  const row = db
    .prepare<[string]>("SELECT * FROM github_tokens WHERE client_id = ?")
    .get(clientId) as GitHubTokenRow;
  return rowToDomain(row);
}

export function getGitHubToken(clientId: string): GitHubTokenRecord | null {
  const row = db
    .prepare<[string]>("SELECT * FROM github_tokens WHERE client_id = ?")
    .get(clientId) as GitHubTokenRow | undefined;
  return row ? rowToDomain(row) : null;
}

export function getGitHubTokenByUserId(userId: string): GitHubTokenRecord | null {
  const row = db
    .prepare<[string]>("SELECT * FROM github_tokens WHERE user_id = ?")
    .get(userId) as GitHubTokenRow | undefined;
  return row ? rowToDomain(row) : null;
}

export function deleteGitHubToken(clientId: string): void {
  db.prepare<[string]>("DELETE FROM github_tokens WHERE client_id = ?").run(clientId);
}

export function deleteGitHubTokenByUserId(userId: string): void {
  db.prepare<[string]>("DELETE FROM github_tokens WHERE user_id = ?").run(userId);
}
