import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    // Each test file gets its own module registry — prevents state leakage
    // between unit tests and integration tests.
    isolate: true,
    // Pool must be "forks" or "threads" (not "vmForks") for better-sqlite3
    // native bindings to load correctly.
    pool: "forks",
    // Set up environment variables before any module is evaluated.
    // This runs in all test files but only matters for integration tests.
    // The setup file sets DATABASE_PATH=":memory:" so db/init.ts uses an
    // in-memory database, and sets WEBHOOK_SECRET/LLM_API_KEY to satisfy
    // startup validation.
    setupFiles: ["./tests/setup.integration.ts"],
  },
});
