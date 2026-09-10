/**
 * Notification Service
 *
 * Sends email via Resend REST API (HTTPS/443) — works on all platforms
 * including Render free tier where SMTP ports are blocked.
 *
 * Requirements: 12.1, 12.2, 12.3
 */
import type { BuildRecord, DiagnosisResult } from "../types.js";
export declare function notify(record: BuildRecord, result: DiagnosisResult): Promise<void>;
//# sourceMappingURL=notificationService.d.ts.map