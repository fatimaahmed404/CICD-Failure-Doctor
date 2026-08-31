/**
 * Express server entry point.
 *
 * startup.ts MUST be called first — before any middleware or route registration —
 * so the process exits immediately if required environment variables are absent.
 *
 * Requirements: 11.2, 11.4
 */
import "./db/init.js";
declare const app: import("express-serve-static-core").Express;
export { app };
//# sourceMappingURL=server.d.ts.map