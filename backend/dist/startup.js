"use strict";
/**
 * Boot-time environment variable guard.
 *
 * Call this as the very first statement in server.ts so the process exits
 * with a clear message rather than failing silently later at runtime.
 *
 * Requirements: 11.2
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnvironment = validateEnvironment;
const REQUIRED_ENV_VARS = ["WEBHOOK_SECRET", "LLM_API_KEY"];
function validateEnvironment() {
    const missing = [];
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
//# sourceMappingURL=startup.js.map