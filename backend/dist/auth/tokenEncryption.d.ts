/**
 * AES-256-GCM token encryption / decryption utility.
 *
 * Uses Node's built-in `crypto` module exclusively — no third-party deps.
 *
 * Key derivation:
 *   The 32-byte encryption key is derived from the TOKEN_ENCRYPTION_KEY
 *   environment variable using `crypto.scrypt` with a fixed, well-known
 *   salt. Using a fixed salt is intentional here: the key itself is the
 *   high-entropy secret and the salt just domain-separates this derivation
 *   from any other use of the same env var.
 *
 *   If TOKEN_ENCRYPTION_KEY is absent at startup, a random 32-byte key is
 *   generated and kept in memory only, which means encrypted tokens will
 *   not survive a process restart (Req 17.17).
 *
 * Ciphertext format (all fields hex-encoded, colon-separated):
 *   <iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * Requirements: 17.5, 17.17
 */
export declare let encryptionKey: Buffer;
/**
 * Reset the module-level key — intended for use in tests only.
 * @internal
 */
export declare function _resetKeyForTesting(): void;
/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * Returns a single colon-separated string:
 *   `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 *
 * A fresh random 12-byte IV is generated for every call so that identical
 * plaintexts produce different ciphertexts (semantic security).
 *
 * Requirements: 17.5
 */
export declare function encryptToken(plaintext: string): string;
/**
 * Decrypt a ciphertext string produced by `encryptToken`.
 *
 * Throws if:
 *  - The format is not exactly `<iv>:<authTag>:<ciphertext>` (three colon-
 *    separated hex segments)
 *  - Any segment is not valid hexadecimal
 *  - The GCM authentication tag does not verify (tampered ciphertext)
 *
 * Requirements: 17.5
 */
export declare function decryptToken(encrypted: string): string;
//# sourceMappingURL=tokenEncryption.d.ts.map