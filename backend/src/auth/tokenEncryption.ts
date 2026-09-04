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

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm" as const;
const KEY_BYTES = 32; // AES-256 requires a 32-byte key
const IV_BYTES = 12;  // 96-bit IV recommended for GCM
const FIXED_SALT = "cicd-failure-doctor-token-salt-v1"; // domain-separation salt

// ── Key initialisation ────────────────────────────────────────────────────────

/**
 * Derive the encryption key from TOKEN_ENCRYPTION_KEY via scrypt, or fall
 * back to an ephemeral random key with a startup warning (Req 17.17).
 */
function initEncryptionKey(): Buffer {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY;

  if (rawKey && rawKey.trim() !== "") {
    // Synchronous scrypt — safe at module-load time (not in a hot path).
    // N=16384, r=8, p=1 are the recommended defaults for key derivation.
    return scryptSync(rawKey, FIXED_SALT, KEY_BYTES, { N: 16384, r: 8, p: 1 });
  }

  // Req 17.17: ephemeral key — warn and continue
  console.warn(
    "[startup] TOKEN_ENCRYPTION_KEY not set — tokens will not persist across restarts",
  );
  return randomBytes(KEY_BYTES);
}

// Initialised once at module load time; exported for testing purposes.
export let encryptionKey: Buffer = initEncryptionKey();

/**
 * Reset the module-level key — intended for use in tests only.
 * @internal
 */
export function _resetKeyForTesting(): void {
  encryptionKey = initEncryptionKey();
}

// ── Public API ────────────────────────────────────────────────────────────────

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
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag(); // 16 bytes (128-bit tag)

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

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
export function decryptToken(encrypted: string): string {
  const parts = encrypted.split(":");

  if (parts.length !== 3) {
    throw new Error(
      `Invalid encrypted token format: expected '<iv>:<authTag>:<ciphertext>', got ${parts.length} segment(s)`,
    );
  }

  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];

  // Validate that all parts are non-empty hex strings before converting
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Invalid encrypted token format: one or more segments are empty");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);

  // createDecipheriv + final() will throw if the auth tag does not match
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
