/**
 * Notification Service
 *
 * Sends Slack and/or email notifications when a BuildRecord transitions to
 * status = "complete". Both channels run independently; failure of one does
 * not prevent the other. All errors are caught and logged; the function
 * always resolves and never affects BuildRecord.status.
 *
 * Requirements: 12.1, 12.2, 12.3
 */
import type { BuildRecord, DiagnosisResult } from "../types.js";
/**
 * Sends a notification after a BuildRecord transitions to `status = "complete"`.
 *
 * - Extracts the first sentence of result.explanation as explanationExcerpt
 * - Builds detailUrl from APP_BASE_URL + /diagnoses/ + record.id
 * - IF SLACK_WEBHOOK_URL is set and non-empty: POST to Slack (catch errors, log, continue)
 * - IF NOTIFICATION_EMAIL is set and non-empty: send email (catch errors, log, continue)
 * - Both channels run independently; function always resolves, never rejects
 *
 * Requirements: 12.1, 12.2, 12.3
 */
export declare function notify(record: BuildRecord, result: DiagnosisResult): Promise<void>;
//# sourceMappingURL=notificationService.d.ts.map