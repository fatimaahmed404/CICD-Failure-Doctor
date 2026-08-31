/**
 * Diagnoses API routes.
 *
 * GET /diagnoses        — paginated + filtered list of DiagnosisSummary objects
 * GET /diagnoses/:id    — full DiagnosisDetail for a single record
 * GET /health           — uptime-monitor ping
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 11.4
 */
declare const router: import("express-serve-static-core").Router;
export { router as diagnosesRouter };
//# sourceMappingURL=diagnoses.d.ts.map