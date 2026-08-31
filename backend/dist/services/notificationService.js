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
import nodemailer from "nodemailer";
/**
 * Extracts the first sentence from a text string.
 * A sentence is defined as text ending with a period, exclamation mark,
 * or question mark, optionally followed by whitespace.
 */
function extractFirstSentence(text) {
    const match = text.match(/^[^.!?]+[.!?]/);
    if (match) {
        return match[0].trim();
    }
    // Fallback: if no sentence terminator found, take first 100 chars
    return text.length > 100 ? text.slice(0, 100) + "..." : text;
}
/**
 * Sends Slack notification via webhook POST.
 * Returns true on success, false on failure (logs error).
 */
async function sendSlackNotification(webhookUrl, category, excerpt, detailUrl) {
    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: `[${category}] ${excerpt} ${detailUrl}`,
            }),
        });
        if (!response.ok) {
            console.error(`[NotificationService] Slack webhook returned ${response.status}: ${await response.text()}`);
            return false;
        }
        console.log(`[NotificationService] Slack notification sent for category: ${category}`);
        return true;
    }
    catch (error) {
        console.error(`[NotificationService] Slack notification failed:`, error instanceof Error ? error.message : String(error));
        return false;
    }
}
/**
 * Sends email notification via nodemailer.
 * Returns true on success, false on failure (logs error).
 *
 * Uses environment variables for SMTP configuration (not yet documented in .env.example):
 * - SMTP_HOST (default: smtp.gmail.com)
 * - SMTP_PORT (default: 587)
 * - SMTP_USER (default: derived from NOTIFICATION_EMAIL)
 * - SMTP_PASS (required if email is enabled)
 */
async function sendEmailNotification(toAddress, category, excerpt, detailUrl) {
    try {
        // Configure SMTP transport
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: parseInt(process.env.SMTP_PORT || "587", 10),
            secure: false, // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USER || toAddress,
                pass: process.env.SMTP_PASS || "",
            },
        });
        const subject = `CI/CD Failure Diagnosed: ${category}`;
        const text = `A CI/CD build failure has been diagnosed.\n\nCategory: ${category}\n\nSummary: ${excerpt}\n\nView full diagnosis: ${detailUrl}`;
        const html = `
      <h2>CI/CD Failure Diagnosed</h2>
      <p><strong>Category:</strong> ${category}</p>
      <p><strong>Summary:</strong> ${excerpt}</p>
      <p><a href="${detailUrl}">View full diagnosis</a></p>
    `;
        await transporter.sendMail({
            from: process.env.SMTP_USER || toAddress,
            to: toAddress,
            subject,
            text,
            html,
        });
        console.log(`[NotificationService] Email notification sent to ${toAddress} for category: ${category}`);
        return true;
    }
    catch (error) {
        console.error(`[NotificationService] Email notification failed:`, error instanceof Error ? error.message : String(error));
        return false;
    }
}
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
export async function notify(record, result) {
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
    const notificationEmail = process.env.NOTIFICATION_EMAIL?.trim();
    const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    // If both notification channels are disabled, return early
    if (!slackWebhookUrl && !notificationEmail) {
        return;
    }
    // Extract first sentence and build detail URL
    const explanationExcerpt = extractFirstSentence(result.explanation);
    const detailUrl = `${appBaseUrl}/diagnoses/${record.id}`;
    // Run both notifications in parallel (independently)
    const promises = [];
    if (slackWebhookUrl) {
        promises.push(sendSlackNotification(slackWebhookUrl, result.category, explanationExcerpt, detailUrl));
    }
    if (notificationEmail) {
        promises.push(sendEmailNotification(notificationEmail, result.category, explanationExcerpt, detailUrl));
    }
    // Wait for all notifications to complete (but don't throw on failure)
    await Promise.allSettled(promises);
}
//# sourceMappingURL=notificationService.js.map