/**
 * Notification Service
 *
 * Sends email via nodemailer using Resend's SMTP relay.
 * Resend's SMTP works on Render free tier (port 465/SSL, not blocked).
 *
 * Resend SMTP settings:
 *   host: smtp.resend.com
 *   port: 465
 *   user: resend
 *   pass: RESEND_API_KEY
 *
 * This lets us use nodemailer (familiar API) AND send to any email address.
 *
 * Requirements: 12.1, 12.2, 12.3
 */
import type { BuildRecord, DiagnosisResult } from "../types.js";
export declare function notify(record: BuildRecord, result: DiagnosisResult): Promise<void>;
//# sourceMappingURL=notificationService.d.ts.map