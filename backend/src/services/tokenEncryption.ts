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

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // bytes

let encryptionKey: Buffer;

function deriveKey(rawKey: string): Buffer {
  // SHA-256 hash of the provided string → 32 bytes
  return crypto.createHash("sha256").update(rawKey).digest();
}

function initKey(): Buffer {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (envKey && envKey.trim() !== "") {
    return deriveKey(envKey);
  }
  // Req 17.17: generate ephemeral key and warn
  console.warn(
    "[tokenEncryption] TOKEN_ENCRYPTION_KEY is not set — " +
      "generating a random key. OAuth tokens will NOT persist across restarts.",
  );
  return crypto.randomBytes(KEY_LENGTH);
}

// Initialise once at module load time
encryptionKey = initKey();

/**
 * Encrypt a plaintext string.
 * Returns a single string: "<iv>:<authTag>:<ciphertext>" (all hex).
 *
 * Requirement: 17.5
 */
export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypt an encrypted token string produced by `encryptToken`.
 * Throws if the ciphertext is malformed or the auth tag does not match.
 *
 * Requirement: 17.5
 */
export function decryptToken(encrypted: string): string {
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex!, "hex");
  const authTag = Buffer.from(authTagHex!, "hex");
  const ciphertext = Buffer.from(ciphertextHex!, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
