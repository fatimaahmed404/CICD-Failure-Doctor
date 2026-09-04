/**
 * Unit tests for tokenEncryption service.
 *
 * Covers:
 *   - encryptToken → decryptToken round-trip (Req 17.5)
 *   - Random IV: same plaintext encrypts differently each time (Req 17.5)
 *   - decryptToken throws on invalid format (< 3 colon-separated segments)
 *   - decryptToken throws when a segment is empty
 *
 * Requirements: 17.5, 17.17
 */

import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "../src/services/tokenEncryption.js";

describe("tokenEncryption", () => {
  // ── Round-trip ──────────────────────────────────────────────────────────────

  describe("encryptToken / decryptToken round-trip", () => {
    it("decrypts back to the original plaintext for a typical GitHub token", () => {
      const plaintext = "ghp_abcdefghijklmnopqrstuvwxyz012345";
      const encrypted = encryptToken(plaintext);
      expect(decryptToken(encrypted)).toBe(plaintext);
    });

    it("decrypts back to the original plaintext for an empty string", () => {
      const plaintext = "";
      const encrypted = encryptToken(plaintext);
      expect(decryptToken(encrypted)).toBe(plaintext);
    });

    it("decrypts back to the original plaintext for a long token", () => {
      const plaintext = "x".repeat(500);
      const encrypted = encryptToken(plaintext);
      expect(decryptToken(encrypted)).toBe(plaintext);
    });

    it("decrypts back to the original plaintext containing special characters", () => {
      const plaintext = "token with spaces & <special> \"chars\"";
      const encrypted = encryptToken(plaintext);
      expect(decryptToken(encrypted)).toBe(plaintext);
    });
  });

  // ── Random IV — semantic security ──────────────────────────────────────────

  describe("random IV", () => {
    it("encrypting the same plaintext twice produces different ciphertexts", () => {
      const plaintext = "my-github-access-token";
      const encrypted1 = encryptToken(plaintext);
      const encrypted2 = encryptToken(plaintext);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it("encrypted output is not equal to the plaintext", () => {
      const plaintext = "some-token-value";
      const encrypted = encryptToken(plaintext);
      expect(encrypted).not.toBe(plaintext);
    });

    it("encrypted format is three colon-separated segments", () => {
      const encrypted = encryptToken("my-token");
      const parts = encrypted.split(":");
      expect(parts).toHaveLength(3);
      // Each segment should be non-empty hex
      for (const part of parts) {
        expect(part).toMatch(/^[0-9a-f]+$/);
      }
    });
  });

  // ── decryptToken error handling ─────────────────────────────────────────────

  describe("decryptToken — invalid input", () => {
    it("throws when input has fewer than 3 colon-separated segments (only 1 segment)", () => {
      expect(() => decryptToken("notcolonseparated")).toThrow();
    });

    it("throws when input has fewer than 3 colon-separated segments (only 2 segments)", () => {
      expect(() => decryptToken("aabbcc:ddeeff")).toThrow();
    });

    it("throws when input has more than 3 colon-separated segments", () => {
      // Extra colons make split produce more than 3 parts
      expect(() => decryptToken("aa:bb:cc:dd")).toThrow();
    });

    it("throws when the IV segment is empty", () => {
      // :<authTag>:<ciphertext> — IV is empty
      expect(() => decryptToken(":aabbcc:ddeeff")).toThrow();
    });

    it("throws when the authTag segment is empty", () => {
      expect(() => decryptToken("aabbcc::ddeeff")).toThrow();
    });

    it("throws when the ciphertext segment is empty", () => {
      expect(() => decryptToken("aabbcc:ddeeff:")).toThrow();
    });

    it("throws when given an entirely empty string", () => {
      expect(() => decryptToken("")).toThrow();
    });

    it("throws when the auth tag does not match (tampered ciphertext)", () => {
      const plaintext = "my-secret-token";
      const encrypted = encryptToken(plaintext);
      // Corrupt the last character of the ciphertext segment
      const parts = encrypted.split(":");
      parts[2] = parts[2]!.slice(0, -2) + "00";
      const tampered = parts.join(":");
      expect(() => decryptToken(tampered)).toThrow();
    });
  });
});
