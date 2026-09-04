/**
 * AES-256-GCM token encryption/decryption utility.
 *
 * Uses Node's built-in `crypto` module.  The 32-byte key is derived from
 * the TOKEN_ENCRYPTION_KEY environment variable (if set) or generated
 * randomly at startup with a warning.
 *
 * The encrypted payload is stored as a Base64-encoded string in the format:
 *   <iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * Requirements: 17.5, 17.17
 */
/**
 * Encrypt a plaintext string.
 * Returns a single string: "<iv>:<authTag>:<ciphertext>" (all hex).
 *
 * Requirement: 17.5
 */
export declare function encryptToken(plaintext: string): string;
/**
 * Decrypt an encrypted token string produced by `encryptToken`.
 * Throws if the ciphertext is malformed or the auth tag does not match.
 *
 * Requirement: 17.5
 */
export declare function decryptToken(encrypted: string): string;
//# sourceMappingURL=tokenEncryption.d.ts.map