/**
 * Unit tests for GitHubConnectionService (services/githubConnection.ts).
 *
 * Tests:
 *   - isOAuthEnabled() feature-flag behaviour (Req 17.1, 17.2)
 *   - getLoginUrl() URL construction (Req 17.3)
 *   - listRepos() error handling for 401/403+rate-limit (Req 17.7, 17.15)
 *   - connectRepo() partial-success path when workflow creation fails (Req 17.9)
 *
 * Requirements: 17.1, 17.2, 17.3, 17.7, 17.9, 17.15
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isOAuthEnabled,
  getLoginUrl,
  listRepos,
  connectRepo,
  GitHubAuthError,
  GitHubRateLimitError,
} from "../src/services/githubConnection.js";

// ── Env helpers ───────────────────────────────────────────────────────────────

let savedClientId: string | undefined;
let savedClientSecret: string | undefined;

beforeEach(() => {
  savedClientId = process.env.GITHUB_CLIENT_ID;
  savedClientSecret = process.env.GITHUB_CLIENT_SECRET;
});

afterEach(() => {
  // Restore env vars
  if (savedClientId === undefined) {
    delete process.env.GITHUB_CLIENT_ID;
  } else {
    process.env.GITHUB_CLIENT_ID = savedClientId;
  }
  if (savedClientSecret === undefined) {
    delete process.env.GITHUB_CLIENT_SECRET;
  } else {
    process.env.GITHUB_CLIENT_SECRET = savedClientSecret;
  }

  // Restore real fetch
  vi.unstubAllGlobals();
});

// ── isOAuthEnabled ────────────────────────────────────────────────────────────

describe("isOAuthEnabled()", () => {
  it("returns false when GITHUB_CLIENT_ID is unset (Req 17.2)", () => {
    delete process.env.GITHUB_CLIENT_ID;
    process.env.GITHUB_CLIENT_SECRET = "some-secret";
    expect(isOAuthEnabled()).toBe(false);
  });

  it("returns false when GITHUB_CLIENT_SECRET is unset (Req 17.2)", () => {
    process.env.GITHUB_CLIENT_ID = "some-id";
    delete process.env.GITHUB_CLIENT_SECRET;
    expect(isOAuthEnabled()).toBe(false);
  });

  it("returns false when GITHUB_CLIENT_ID is an empty string (Req 17.2)", () => {
    process.env.GITHUB_CLIENT_ID = "";
    process.env.GITHUB_CLIENT_SECRET = "some-secret";
    expect(isOAuthEnabled()).toBe(false);
  });

  it("returns false when GITHUB_CLIENT_SECRET is an empty string (Req 17.2)", () => {
    process.env.GITHUB_CLIENT_ID = "some-id";
    process.env.GITHUB_CLIENT_SECRET = "";
    expect(isOAuthEnabled()).toBe(false);
  });

  it("returns false when both are unset (Req 17.2)", () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    expect(isOAuthEnabled()).toBe(false);
  });

  it("returns true when both are set to non-empty values (Req 17.1)", () => {
    process.env.GITHUB_CLIENT_ID = "Iv1.abc123";
    process.env.GITHUB_CLIENT_SECRET = "super-secret";
    expect(isOAuthEnabled()).toBe(true);
  });
});

// ── getLoginUrl ───────────────────────────────────────────────────────────────

describe("getLoginUrl(state)", () => {
  beforeEach(() => {
    process.env.GITHUB_CLIENT_ID = "test-client-id";
    process.env.APP_BASE_URL = "http://localhost:3000";
    delete process.env.GITHUB_REDIRECT_URI;
  });

  it("returns a URL starting with https://github.com/login/oauth/authorize (Req 17.3)", () => {
    const url = getLoginUrl("test-state-value");
    expect(url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize/);
  });

  it("includes client_id in the query string (Req 17.3)", () => {
    const url = getLoginUrl("some-state");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
  });

  it("includes scope=repo in the query string (Req 17.3)", () => {
    const url = getLoginUrl("some-state");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe("repo");
  });

  it("includes the provided state in the query string (Req 17.3)", () => {
    const state = "my-unique-state-abc123";
    const url = getLoginUrl(state);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("state")).toBe(state);
  });

  it("includes a redirect_uri in the query string (Req 17.3)", () => {
    const url = getLoginUrl("some-state");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("redirect_uri")).toBeTruthy();
  });

  it("redirect_uri defaults to APP_BASE_URL/auth/github/callback when GITHUB_REDIRECT_URI is not set", () => {
    const url = getLoginUrl("some-state");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/auth/github/callback",
    );
  });

  it("uses GITHUB_REDIRECT_URI when explicitly set", () => {
    process.env.GITHUB_REDIRECT_URI = "https://myapp.example.com/auth/github/callback";
    const url = getLoginUrl("some-state");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://myapp.example.com/auth/github/callback",
    );
  });
});

// ── listRepos — error handling ────────────────────────────────────────────────

describe("listRepos(accessToken)", () => {
  it("throws GitHubAuthError when GitHub API returns HTTP 401 (Req 17.7)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
    } as unknown as Response));

    await expect(listRepos("some-access-token")).rejects.toThrow(GitHubAuthError);
  });

  it("throws GitHubAuthError with a descriptive message on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
    } as unknown as Response));

    await expect(listRepos("some-access-token")).rejects.toThrow(
      /reconnect/i,
    );
  });

  it("throws GitHubRateLimitError when GitHub API returns HTTP 403 with X-RateLimit-Remaining: 0 (Req 17.15)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: {
        get: (name: string) => {
          if (name === "X-RateLimit-Remaining") return "0";
          if (name === "X-RateLimit-Reset") return "1700000000";
          return null;
        },
      },
    } as unknown as Response));

    await expect(listRepos("some-access-token")).rejects.toThrow(GitHubRateLimitError);
  });

  it("GitHubRateLimitError includes the reset timestamp (Req 17.15)", async () => {
    const resetTimestamp = "1700000000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: {
        get: (name: string) => {
          if (name === "X-RateLimit-Remaining") return "0";
          if (name === "X-RateLimit-Reset") return resetTimestamp;
          return null;
        },
      },
    } as unknown as Response));

    let caughtError: GitHubRateLimitError | null = null;
    try {
      await listRepos("some-access-token");
    } catch (err) {
      if (err instanceof GitHubRateLimitError) caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.resetTimestamp).toBe(resetTimestamp);
  });

  it("returns filtered repo list when GitHub API call succeeds", async () => {
    const mockRepos = [
      {
        name: "my-repo",
        full_name: "owner/my-repo",
        default_branch: "main",
        html_url: "https://github.com/owner/my-repo",
        permissions: { push: true, admin: false },
      },
      {
        name: "read-only-repo",
        full_name: "owner/read-only-repo",
        default_branch: "main",
        html_url: "https://github.com/owner/read-only-repo",
        permissions: { push: false, admin: false },
      },
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockRepos,
      headers: { get: () => null },
    } as unknown as Response));

    const repos = await listRepos("valid-token");

    expect(repos).toHaveLength(1);
    expect(repos[0]!.full_name).toBe("owner/my-repo");
  });
});

// ── connectRepo — partial success path ───────────────────────────────────────

/**
 * Generate a real libsodium Curve25519 public key in base64 for use as a
 * mock GitHub repo public key.  The all-zeros buffer is NOT a valid Curve25519
 * key and causes sodium.crypto_box_seal to throw "invalid usage".
 */
async function realFakePublicKey(): Promise<string> {
  const sodium = await import("libsodium-wrappers");
  await sodium.ready;
  const kp = sodium.crypto_box_keypair();
  return sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL);
}

describe("connectRepo(accessToken, repoFullName)", () => {
  it("returns ConnectRepoPartial when secrets succeed but workflow file creation fails (Req 17.9)", async () => {
    const fakeKey = await realFakePublicKey();

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);

      // Step 1: public-key endpoint → success
      if (urlStr.includes("/actions/secrets/public-key")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ key: fakeKey, key_id: "test-key-id" }),
          headers: { get: () => null },
        };
      }

      // Steps 3 & 4: secret PUT endpoints → success (204 No Content)
      if (
        urlStr.includes("/actions/secrets/CICD_DOCTOR_SECRET") ||
        urlStr.includes("/actions/secrets/CICD_DOCTOR_URL")
      ) {
        return {
          ok: true,
          status: 204,
          json: async () => ({}),
          headers: { get: () => null },
        };
      }

      // Step 5 check: GET existing workflow file → 404 (file doesn't exist)
      if (urlStr.includes("/contents/") && init?.method !== "PUT") {
        return {
          ok: false,
          status: 404,
          json: async () => ({ message: "Not Found" }),
          headers: { get: () => null },
        };
      }

      // Step 5 PUT: workflow file creation → fail
      if (urlStr.includes("/contents/") && init?.method === "PUT") {
        return {
          ok: false,
          status: 422,
          text: async () => "Unprocessable Entity",
          headers: { get: () => null },
        };
      }

      // Default: unexpected call
      return {
        ok: false,
        status: 500,
        text: async () => "Unexpected request",
        headers: { get: () => null },
      };
    }));

    const result = await connectRepo("valid-access-token", "owner/my-repo");

    // Should be a partial result (not full success)
    expect("success" in result).toBe(false);
    expect("secretsCreated" in result).toBe(true);

    // Type-narrow to ConnectRepoPartial
    if (!("success" in result)) {
      expect(result.secretsCreated).toBe(true);
      expect(result.workflowCreated).toBe(false);
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
      expect(typeof result.manualSetupUrl).toBe("string");
    }
  });

  it("throws an error for invalid repoFullName format", async () => {
    await expect(
      connectRepo("valid-token", "invalid-repo-name-without-slash"),
    ).rejects.toThrow();
  });

  it("returns ConnectRepoSuccess with workflowUrl when everything succeeds", async () => {
    const fakeKey = await realFakePublicKey();

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);

      if (urlStr.includes("/actions/secrets/public-key")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ key: fakeKey, key_id: "test-key-id" }),
          headers: { get: () => null },
        };
      }

      if (
        urlStr.includes("/actions/secrets/CICD_DOCTOR_SECRET") ||
        urlStr.includes("/actions/secrets/CICD_DOCTOR_URL")
      ) {
        return {
          ok: true,
          status: 204,
          json: async () => ({}),
          headers: { get: () => null },
        };
      }

      // GET existing workflow file → 404 (new file)
      if (urlStr.includes("/contents/") && init?.method !== "PUT") {
        return {
          ok: false,
          status: 404,
          json: async () => ({ message: "Not Found" }),
          headers: { get: () => null },
        };
      }

      // PUT workflow file → success
      if (urlStr.includes("/contents/") && init?.method === "PUT") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            content: {
              html_url:
                "https://github.com/owner/my-repo/blob/main/.github/workflows/cicd-failure-doctor.yml",
            },
          }),
          headers: { get: () => null },
        };
      }

      return {
        ok: false,
        status: 500,
        text: async () => "Unexpected request",
        headers: { get: () => null },
      };
    }));

    const result = await connectRepo("valid-access-token", "owner/my-repo");

    expect("success" in result).toBe(true);
    if ("success" in result) {
      expect(result.success).toBe(true);
      expect(result.repoFullName).toBe("owner/my-repo");
      expect(result.workflowUrl).toContain("github.com");
    }
  });
});
