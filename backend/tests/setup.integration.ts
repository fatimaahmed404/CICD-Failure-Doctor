/**
 * Integration test setup file.
 *
 * Sets required environment variables before any module is imported.
 * This file is loaded via vitest's `setupFiles` option so it runs
 * as early as possible in the test lifecycle.
 */

// Must be set before db/init.ts is first imported so it uses the in-memory DB.
process.env.DATABASE_PATH = ":memory:";

// Must be set so validateWebhookRequest() and startup.ts are satisfied.
process.env.WEBHOOK_SECRET = "test-secret";
process.env.LLM_API_KEY = "test-llm-key";
