"use strict";
/**
 * Data-access functions for the github_tokens table.
 *
 * Requirements: 17.18, 18.9
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertGitHubToken = upsertGitHubToken;
exports.getGitHubToken = getGitHubToken;
exports.getGitHubTokenByUserId = getGitHubTokenByUserId;
exports.deleteGitHubToken = deleteGitHubToken;
exports.deleteGitHubTokenByUserId = deleteGitHubTokenByUserId;
const init_js_1 = require("./init.js");
function rowToDomain(row) {
    return {
        clientId: row.client_id,
        encryptedToken: row.encrypted_token,
        githubUsername: row.github_username,
        createdAt: new Date(row.created_at),
        userId: row.user_id ?? null,
    };
}
function upsertGitHubToken(clientId, encryptedToken, githubUsername, userId) {
    const now = new Date().toISOString();
    init_js_1.db.prepare(`
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
    const row = init_js_1.db
        .prepare("SELECT * FROM github_tokens WHERE client_id = ?")
        .get(clientId);
    return rowToDomain(row);
}
function getGitHubToken(clientId) {
    const row = init_js_1.db
        .prepare("SELECT * FROM github_tokens WHERE client_id = ?")
        .get(clientId);
    return row ? rowToDomain(row) : null;
}
function getGitHubTokenByUserId(userId) {
    const row = init_js_1.db
        .prepare("SELECT * FROM github_tokens WHERE user_id = ?")
        .get(userId);
    return row ? rowToDomain(row) : null;
}
function deleteGitHubToken(clientId) {
    init_js_1.db.prepare("DELETE FROM github_tokens WHERE client_id = ?").run(clientId);
}
function deleteGitHubTokenByUserId(userId) {
    init_js_1.db.prepare("DELETE FROM github_tokens WHERE user_id = ?").run(userId);
}
//# sourceMappingURL=githubTokens.js.map