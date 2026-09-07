"use strict";
/**
 * Data-access functions for the github_tokens table.
 *
 * Stores and retrieves encrypted OAuth tokens associated with anonymous
 * client IDs.  The actual encryption/decryption is handled by
 * tokenEncryption.ts; this module only deals with persistence.
 *
 * Requirements: 17.18
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertGitHubToken = upsertGitHubToken;
exports.getGitHubToken = getGitHubToken;
exports.deleteGitHubToken = deleteGitHubToken;
const init_js_1 = require("./init.js");
function rowToDomain(row) {
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
function upsertGitHubToken(clientId, encryptedToken, githubUsername) {
    const now = new Date().toISOString();
    init_js_1.db.prepare(`
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
    const row = init_js_1.db
        .prepare("SELECT * FROM github_tokens WHERE client_id = ?")
        .get(clientId);
    return rowToDomain(row);
}
/**
 * Retrieve the token record for a client.
 * Returns null if no token is stored.
 *
 * Requirement: 17.6
 */
function getGitHubToken(clientId) {
    const row = init_js_1.db
        .prepare("SELECT * FROM github_tokens WHERE client_id = ?")
        .get(clientId);
    return row ? rowToDomain(row) : null;
}
/**
 * Delete the token record for a client (disconnect flow).
 *
 * Requirement: 17.20
 */
function deleteGitHubToken(clientId) {
    init_js_1.db.prepare("DELETE FROM github_tokens WHERE client_id = ?").run(clientId);
}
//# sourceMappingURL=githubTokens.js.map