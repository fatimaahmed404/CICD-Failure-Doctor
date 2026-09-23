/**
 * Notification Service
 *
 * Sends email via Brevo's HTTP API (https://api.brevo.com/v3/smtp/email).
 * Uses HTTPS/443 — works on Render free tier where SMTP ports (587/465) are blocked.
 * Sends to ANY email address. 300 free emails/day.
 *
 * Required env vars:
 *   BREVO_API_KEY   — from Brevo dashboard → SMTP & API → API Keys (starts with xkeysib-)
 *   BREVO_FROM_EMAIL — verified sender email (e.g. your Brevo account email)
 *   BREVO_FROM_NAME  — display name (optional, defaults to "CI/CD Failure Doctor")
 *
 * Requirements: 12.1, 12.2, 12.3
 */
import type { BuildRecord, DiagnosisResult } from "../types.js";
export declare function notify(record: BuildRecord, result: DiagnosisResult): Promise<void>;
//# sourceMappingURL=notificationService.d.ts.map