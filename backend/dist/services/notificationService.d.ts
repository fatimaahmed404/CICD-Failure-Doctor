/**
 * Notification Service
 *
 * Sends email via Brevo SMTP (smtp-relay.brevo.com:587).
 * Brevo works on Render free tier and sends to ANY email address.
 * 300 free emails/day, no domain verification needed.
 *
 * Required env vars:
 *   SMTP_HOST=smtp-relay.brevo.com
 *   SMTP_PORT=587
 *   SMTP_USER=<brevo-login>
 *   SMTP_PASS=<brevo-smtp-key>
 *   SMTP_FROM=CI/CD Failure Doctor <brevo-login>
 *
 * Requirements: 12.1, 12.2, 12.3
 */
import type { BuildRecord, DiagnosisResult } from "../types.js";
export declare function notify(record: BuildRecord, result: DiagnosisResult): Promise<void>;
//# sourceMappingURL=notificationService.d.ts.map