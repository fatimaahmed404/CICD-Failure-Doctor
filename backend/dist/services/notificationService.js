"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = notify;
const users_js_1 = require("../db/users.js");
function extractFirstSentence(text) {
    const match = text.match(/^[^.!?]+[.!?]/);
    if (match)
        return match[0].trim();
    return text.length > 100 ? text.slice(0, 100) + "..." : text;
}
async function sendEmail(toAddress, repoName, jobName, category, excerpt, frontendUrl) {
    const apiKey = process.env.BREVO_API_KEY?.trim();
    if (!apiKey) {
        console.warn("[NotificationService] BREVO_API_KEY not set — skipping email");
        return false;
    }
    const fromEmail = process.env.BREVO_FROM_EMAIL?.trim() || "fatiimaahmed06@gmail.com";
    const fromName = process.env.BREVO_FROM_NAME?.trim() || "CI/CD Failure Doctor";
    const subject = `🔴 Build Failed: ${repoName}`;
    const htmlContent = `
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
    const textContent = [
        `CI/CD Build Failed`,
        `Repository: ${repoName}`,
        `Job: ${jobName}`,
        `Category: ${category}`,
        `Summary: ${excerpt}`,
        ``,
        `Dashboard: ${frontendUrl}`,
    ].join("\n");
    try {
        console.log(`[NotificationService] Sending email to ${toAddress} via Brevo API...`);
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
                "api-key": apiKey,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({
                sender: { email: fromEmail, name: fromName },
                to: [{ email: toAddress }],
                subject,
                htmlContent,
                textContent,
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "unknown");
            console.error(`[NotificationService] Brevo API error ${res.status}: ${body}`);
            return false;
        }
        const data = await res.json().catch(() => ({}));
        console.log(`[NotificationService] Email sent to ${toAddress} — messageId: ${data.messageId}`);
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
    const hasEmail = Boolean(recipientEmail && process.env.BREVO_API_KEY?.trim());
    const hasSlack = Boolean(slackWebhookUrl);
    console.log("[NotificationService] notify():", {
        recordId: record.id,
        userId: record.userId,
        recipientEmail: recipientEmail ?? "none",
        hasBrevoKey: Boolean(process.env.BREVO_API_KEY?.trim()),
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