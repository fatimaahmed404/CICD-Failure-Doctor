/**
 * POST /simulate route
 *
 * Provides a first-class demo path. Accepts an optional scenario name, loads
 * the corresponding bundled fixture log, injects synthetic metadata, and runs
 * the payload through the same ingestBuild + job-queue pipeline as a real
 * webhook — so the full truncation and LLM analysis path is exercised.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=simulate.d.ts.map