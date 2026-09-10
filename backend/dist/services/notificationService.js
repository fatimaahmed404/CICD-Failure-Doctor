"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = notify;
const nodemailer_1 = __importDefault(require("nodemailer"));
const users_js_1 = require("../db/users.js");
function extractFirstSentence(text) {
    const match = text.match(/^[^.!?]+[.!?]/);
    if (match)
        return match[0].trim();
    return text.length > 100 ? text.slice(0, 100) + "..." : text;
}
function createTransporter() {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();
    if (!host || !user || !pass)
        return null;
    return nodemailer_1.default.createTransport({
        host,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: false,
        auth: { user, pass },
    });
}
async function sendEmail(toAddress, repoName, jobName, category, excerpt, frontendUrl) {
    const transporter = createTransporter();
    if (!transporter) {
        console.warn("[NotificationService] SMTP not configured — skipping email");
        return false;
    }
    const fromAddress = process.env.SMTP_FROM?.trim()
        || process.env.SMTP_USER?.trim()
        || "noreply@cicd-doctor.dev";
    const subject = `🔴 Build Failed: ${repoName}`;
    const html = `
    <div style="font-family:sans-serif;max-width:600px;padding:24px;border:1px solid #eee;border-radius:8px">
      <h2 style="color:#e74c3c;margin:0 0 20px">🔴 CI/CD Build Failed</h2>
      <p><strong>Repository:</strong> ${repoName}</p>
      <p><strong>Job:</strong> ${jobName}</p>
      <p><strong>Failure Category:</strong> ${category}</p>
      <p><strong>Summary:</strong> ${excerpt}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
      <p style="color:#7f8c8d;font-size:0.85rem">
        Log in to your
        <a href="${frontendUrl}" style="color:#3498db">CI/CD Failure Doctor dashboard</a>
        to view the full diagnosis and suggested fix.
      </p>
    </div>`;
    const text = [
        `CI/CD Build Failed`,
        `Repository: ${repoName}`,
        `Job: ${jobName}`,
        `Category: ${category}`,
        `Summary: ${excerpt}`,
        ``,
        `Dashboard: ${frontendUrl}`,
    ].join("\n");
    try {
        const info = await transporter.sendMail({
            from: fromAddress,
            to: toAddress,
            subject,
            html,
            text,
        });
        console.log(`[NotificationService] Email sent to ${toAddress} — ${info.messageId}`);
        return true;
    }
    catch (err) {
        console.error("[NotificationService] Email failed:", err instanceof Error ? err.message : String(err));
        return false;
    }
}
async function sendSlackNotification(webhookUrl, category, excerpt, detailUrl) {
    try {
        const r = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: `[${category}] ${excerpt} ${detailUrl}` }),
        });
        if (!r.ok) {
            console.error(`[NotificationService] Slack error ${r.status}`);
            return false;
        }
        console.log(`[NotificationService] Slack sent for: ${category}`);
        return true;
    }
    catch (err) {
        console.error("[NotificationService] Slack failed:", err instanceof Error ? err.message : String(err));
        return false;
    }
}
async function notify(record, result) {
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
    const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const frontendUrl = process.env.FRONTEND_URL?.trim() || appBaseUrl;
    // Use record owner's email; fall back to NOTIFICATION_EMAIL for anonymous records
    let recipientEmail;
    if (record.userId) {
        const user = (0, users_js_1.getUserById)(record.userId);
        if (user?.email)
            recipientEmail = user.email;
    }
    if (!recipientEmail) {
        recipientEmail = process.env.NOTIFICATION_EMAIL?.trim();
    }
    const smtpReady = Boolean(process.env.SMTP_HOST?.trim() &&
        process.env.SMTP_USER?.trim() &&
        process.env.SMTP_PASS?.trim());
    const hasEmail = Boolean(recipientEmail && smtpReady);
    const hasSlack = Boolean(slackWebhookUrl);
    console.log("[NotificationService] notify():", {
        recordId: record.id,
        userId: record.userId,
        recipientEmail: recipientEmail ?? "none",
        smtpReady,
        hasEmail,
        hasSlack,
    });
    if (!hasEmail && !hasSlack) {
        console.warn("[NotificationService] No channels ready — skipping");
        return;
    }
    const excerpt = extractFirstSentence(result.explanation);
    const detailUrl = `${frontendUrl}/diagnoses/${record.id}`;
    const promises = [];
    if (hasSlack) {
        promises.push(sendSlackNotification(slackWebhookUrl, result.category, excerpt, detailUrl));
    }
    if (hasEmail) {
        promises.push(sendEmail(recipientEmail, record.repoName ?? "unknown", record.jobName ?? "unknown", result.category, excerpt, frontendUrl));
    }
    await Promise.allSettled(promises);
}
//# sourceMappingURL=notificationService.js.map