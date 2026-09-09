/**
 * Notification Service
 *
 * Sends email notifications when a BuildRecord transitions to status="complete".
 * Uses Resend (https://resend.com) via their REST API over HTTPS — works on all
 * cloud platforms including Render free tier (which blocks outbound SMTP).
 *
 * Setup: set RESEND_API_KEY in environment variables (free at resend.com).
 * From address: set RESEND_FROM_EMAIL (e.g. "CI/CD Doctor <noreply@yourdomain.com>")
 *
 * Falls back to NOTIFICATION_EMAIL as the recipient for demo/anonymous records.
 *
 * Requirements: 12.1, 12.2, 12.3
 */
import type { BuildRecord, DiagnosisResult } from "../types.js";
/**
 * Main notification entry point — called after a diagnosis completes.
 */
export declare function notify(record: BuildRecord, result: DiagnosisResult): Promise<void>;
//# sourceMappingURL=notificationService.d.ts.map