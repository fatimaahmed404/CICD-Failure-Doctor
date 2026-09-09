"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = notify;
const nodemailer_1 = __importDefault(require("nodemailer"));
const users_js_1 = require("../db/users.js");
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
async function sendEmailNotification(toAddress, category, excerpt, detailUrl, repoName, jobName) {
    try {
        const transporter = nodemailer_1.default.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: parseInt(process.env.SMTP_PORT || "587", 10),
            secure: false,
            auth: {
                user: process.env.SMTP_USER || toAddress,
                pass: process.env.SMTP_PASS || "",
            },
        });
        const repoLine = repoName ? `\n\nRepository: ${repoName}` : "";
        const jobLine = jobName ? `\nJob: ${jobName}` : "";
        const subject = `🔴 CI/CD Build Failed: ${repoName ?? category}`;
        const text = [
            `Your CI/CD build has failed and been diagnosed by CI/CD Failure Doctor.`,
            repoLine + jobLine,
            `\nFailure Category: ${category}`,
            `\nSummary: ${excerpt}`,
            `\nView the full diagnosis and suggested fix:\n${detailUrl}`,
        ].join("");
        const html = `
      <div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#e74c3c">🔴 CI/CD Build Failed</h2>
        ${repoName ? `<p><strong>Repository:</strong> ${repoName}</p>` : ""}
        ${jobName ? `<p><strong>Job:</strong> ${jobName}</p>` : ""}
        <p><strong>Failure Category:</strong> ${category}</p>
        <p><strong>Summary:</strong> ${excerpt}</p>
        <p style="margin-top:24px">
          <a href="${detailUrl}" style="background:#3498db;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">
            View Full Diagnosis &amp; Fix →
          </a>
        </p>
        <p style="color:#7f8c8d;font-size:0.85rem;margin-top:24px">
          Sent by <a href="${process.env.FRONTEND_URL || "https://cicd-failure-doctor-frontend.vercel.app"}">CI/CD Failure Doctor</a>
        </p>
      </div>
    `;
        await transporter.sendMail({
            from: `"CI/CD Failure Doctor" <${process.env.SMTP_USER || toAddress}>`,
            to: toAddress,
            subject,
            text,
            html,
        });
        console.log(`[NotificationService] Email sent to ${toAddress} for ${repoName ?? category}`);
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
async function notify(record, result) {
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
    const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const frontendUrl = (process.env.FRONTEND_URL?.trim() || appBaseUrl);
    // Resolve the email to notify:
    // 1. If the record belongs to a user, email THAT user (per-user notification).
    // 2. Fall back to NOTIFICATION_EMAIL env var (admin/demo catch-all).
    let recipientEmail;
    if (record.userId) {
        const user = (0, users_js_1.getUserById)(record.userId);
        if (user?.email) {
            recipientEmail = user.email;
        }
    }
    if (!recipientEmail) {
        recipientEmail = process.env.NOTIFICATION_EMAIL?.trim();
    }
    const hasEmail = Boolean(recipientEmail);
    const hasSlack = Boolean(slackWebhookUrl);
    if (!hasEmail && !hasSlack) {
        return; // nothing configured
    }
    const explanationExcerpt = extractFirstSentence(result.explanation);
    // Link to the frontend detail page, not the backend
    const detailUrl = `${frontendUrl}/diagnoses/${record.id}`;
    const promises = [];
    if (hasSlack) {
        promises.push(sendSlackNotification(slackWebhookUrl, result.category, explanationExcerpt, detailUrl));
    }
    if (hasEmail) {
        promises.push(sendEmailNotification(recipientEmail, result.category, explanationExcerpt, detailUrl, record.repoName, record.jobName));
    }
    await Promise.allSettled(promises);
}
//# sourceMappingURL=notificationService.js.map