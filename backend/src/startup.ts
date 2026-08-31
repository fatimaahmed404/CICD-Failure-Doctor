/**
 * Boot-time environment variable guard.
 *
 * Call this as the very first statement in server.ts so the process exits
 * with a clear message rather than failing silently later at runtime.
 *
 * Requirements: 11.2
 */

const REQUIRED_ENV_VARS = ["WEBHOOK_SECRET", "LLM_API_KEY"] as const;

export function validateEnvironment(): void {
  const missing: string[] = [];

  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[startup] Missing required environment variable: ${key}`);
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    process.exit(1);
  }
}
