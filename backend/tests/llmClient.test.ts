/**
 * Unit tests for diagnoseBuild (backend/src/llmClient.ts)
 *
 * Strategy: the OpenAI client is constructed lazily inside getClient().
 * We reset the module registry between tests so each test gets a fresh
 * client instance, then swap out `client.chat.completions.create` with a
 * vi.fn() stub before calling diagnoseBuild().
 *
 * Requirements: 5.2, 5.3
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DiagnosisInput } from "../src/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const validInput: DiagnosisInput = {
  cleanedLog: "Error: cannot find module 'lodash'",
  repoName: "demo/repo",
  jobName: "CI / test",
  source: "github",
};

/** Wraps a raw string as the shape returned by the OpenAI SDK. */
function makeOpenAIResponse(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

/** A valid DiagnosisResult JSON string the LLM might return. */
const validResponseJson = JSON.stringify({
  category: "dependency-build-error",
  explanation: "The build failed because lodash is not installed.",
  suggestedFix: "Run `npm install lodash` to fix this.",
  confidence: "high",
});

// ── Mock the openai module ────────────────────────────────────────────────────
//
// vi.mock hoists to the top of the file, so the factory runs before any
// imports. We capture a mutable `mockCreate` so individual tests can control
// what the stub returns or throws.

const mockCreate = vi.fn();

vi.mock("openai", async (importOriginal) => {
  // Keep the original error classes so the llmClient error-handling branches
  // that do `instanceof APIConnectionTimeoutError` / `instanceof APIError`
  // work correctly.
  const original =
    await importOriginal<typeof import("openai")>();

  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  }

  return {
    ...original,
    default: MockOpenAI,
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("diagnoseBuild", () => {
  beforeEach(() => {
    // Reset the lazy-singleton client between tests by resetting module-level state.
    // We achieve this by clearing and reconfiguring the mock on each test.
    vi.resetModules();
    mockCreate.mockReset();
    process.env.LLM_API_KEY = "test-api-key";
    process.env.LLM_MODEL = "gpt-4o-mini";
  });

  it("returns a DiagnosisResult when the LLM responds with valid JSON", async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(validResponseJson));

    // Import fresh after resetModules so the client singleton is re-created
    const { diagnoseBuild } = await import("../src/llmClient.js");
    const result = await diagnoseBuild(validInput);

    expect(result).toEqual({
      category: "dependency-build-error",
      explanation: "The build failed because lodash is not installed.",
      suggestedFix: "Run `npm install lodash` to fix this.",
      confidence: "high",
    });
  });

  it("throws LLMParseError when the LLM returns invalid JSON", async () => {
    mockCreate.mockResolvedValue(makeOpenAIResponse("not valid json {{"));

    const { diagnoseBuild, LLMParseError } = await import(
      "../src/llmClient.js"
    );

    await expect(diagnoseBuild(validInput)).rejects.toThrow(LLMParseError);
    await expect(diagnoseBuild(validInput)).rejects.toThrow(
      /not valid JSON/i,
    );
  });

  it("throws LLMParseError when a required field is missing (confidence)", async () => {
    const missingConfidence = JSON.stringify({
      category: "test-failure",
      explanation: "Tests failed.",
      suggestedFix: "Fix the tests.",
      // confidence intentionally omitted
    });
    mockCreate.mockResolvedValue(makeOpenAIResponse(missingConfidence));

    const { diagnoseBuild, LLMParseError } = await import(
      "../src/llmClient.js"
    );

    await expect(diagnoseBuild(validInput)).rejects.toThrow(LLMParseError);
    await expect(diagnoseBuild(validInput)).rejects.toThrow(
      /schema validation/i,
    );
  });

  it("throws LLMParseError when the category value is not in the allowed enum", async () => {
    const badCategory = JSON.stringify({
      category: "completely-made-up-category",
      explanation: "Something went wrong.",
      suggestedFix: "Try again.",
      confidence: "medium",
    });
    mockCreate.mockResolvedValue(makeOpenAIResponse(badCategory));

    const { diagnoseBuild, LLMParseError } = await import(
      "../src/llmClient.js"
    );

    await expect(diagnoseBuild(validInput)).rejects.toThrow(LLMParseError);
    await expect(diagnoseBuild(validInput)).rejects.toThrow(
      /schema validation/i,
    );
  });

  it("throws NetworkError on a connection timeout (APIConnectionTimeoutError)", async () => {
    const { APIConnectionTimeoutError } = await import("openai");

    mockCreate.mockRejectedValue(
      new APIConnectionTimeoutError({ message: "Request timed out" }),
    );

    const { diagnoseBuild, NetworkError } = await import(
      "../src/llmClient.js"
    );

    await expect(diagnoseBuild(validInput)).rejects.toThrow(NetworkError);
    await expect(diagnoseBuild(validInput)).rejects.toThrow(/timed out/i);
  });

  it("throws NetworkError on a 5xx API error (APIError)", async () => {
    const { APIError } = await import("openai");

    mockCreate.mockRejectedValue(
      new APIError(500, undefined, "Internal Server Error", {}),
    );

    const { diagnoseBuild, NetworkError } = await import(
      "../src/llmClient.js"
    );

    await expect(diagnoseBuild(validInput)).rejects.toThrow(NetworkError);
    await expect(diagnoseBuild(validInput)).rejects.toThrow(/LLM API error/i);
  });
});
