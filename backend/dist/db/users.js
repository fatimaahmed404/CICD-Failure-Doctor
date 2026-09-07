"use strict";
/**
 * User data-access functions.
 *
 * Handles creation and lookup of user records.
 * Webhook secrets are generated per-user at signup.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserValidationError = void 0;
exports.insertUser = insertUser;
exports.getUserByEmail = getUserByEmail;
exports.getUserById = getUserById;
exports.getUserByWebhookSecret = getUserByWebhookSecret;
const init_js_1 = require("./init.js");
const crypto_1 = require("crypto");
class UserValidationError extends Error {
    field;
    constructor(message, field) {
        super(message);
        this.name = "UserValidationError";
        this.field = field;
    }
}
exports.UserValidationError = UserValidationError;
function rowToDomain(row) {
    return {
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        webhookSecret: row.webhook_secret,
        createdAt: row.created_at,
    };
}
function insertUser(email, passwordHash) {
    const id = (0, crypto_1.randomUUID)();
    const webhookSecret = (0, crypto_1.randomBytes)(32).toString("hex");
    const createdAt = Date.now();
    try {
        init_js_1.db.prepare(`INSERT INTO users (id, email, password_hash, webhook_secret, created_at)
       VALUES (?, ?, ?, ?, ?)`).run(id, email, passwordHash, webhookSecret, createdAt);
    }
    catch (err) {
        if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
            throw new UserValidationError("Email already in use", "email");
        }
        throw err;
    }
    return { id, email, passwordHash, webhookSecret, createdAt };
}
function getUserByEmail(email) {
    const row = init_js_1.db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    return row ? rowToDomain(row) : null;
}
function getUserById(id) {
    const row = init_js_1.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    return row ? rowToDomain(row) : null;
}
function getUserByWebhookSecret(webhookSecret) {
    const row = init_js_1.db.prepare("SELECT * FROM users WHERE webhook_secret = ?").get(webhookSecret);
    return row ? rowToDomain(row) : null;
}
//# sourceMappingURL=users.js.map