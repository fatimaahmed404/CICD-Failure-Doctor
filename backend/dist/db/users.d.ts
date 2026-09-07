/**
 * User data-access functions.
 *
 * Handles creation and lookup of user records.
 * Webhook secrets are generated per-user at signup.
 */
import type { UserRecord } from "../types.js";
export declare class UserValidationError extends Error {
    readonly field: string;
    constructor(message: string, field: string);
}
export declare function insertUser(email: string, passwordHash: string): UserRecord;
export declare function getUserByEmail(email: string): UserRecord | null;
export declare function getUserById(id: string): UserRecord | null;
export declare function getUserByWebhookSecret(webhookSecret: string): UserRecord | null;
//# sourceMappingURL=users.d.ts.map