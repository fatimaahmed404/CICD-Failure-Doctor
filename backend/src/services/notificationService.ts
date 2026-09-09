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
import { getUserById } from "../db/users.js";

function extractFirstSentence(text: string): string {
  const match = text.match(/^[^.!?]+[.!?]/);
  if (match) return match[0].trim();
  return text.length > 100 ? text.slice(0, 100) + "..." : text;
}

/**
 * Send email via Resend REST API.
 * Does NOT use nodemailer or SMTP — uses HTTPS which works on all platforms.
 */
async function sendEmail(
  toAddress: string,
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[NotificationService] RESEND_API_KEY not set — skipping email");
    return false;
  }

  const fromAddress = process.env.RESEND_FROM_EMAIL?.trim()
    || "CI/CD Failure Doctor <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromAddress, to: toAddress, subject, html, text }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "unknown");
      console.error(`[NotificationService] Resend API error ${res.status}: ${body}`);
      return false;
    }

    const data = await res.json() as { id?: string };
    console.log(`[NotificationService] Email sent to ${toAddress} — id: ${data.id}`);
    return true;
  } catch (err) {
    console.error("[NotificationService] Email send failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Send Slack notification via incoming webhook.
 */
async function sendSlackNotification(
  webhookUrl: string,
  category: string,
  excerpt: string,
  detailUrl: string,
): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `[${category}] ${excerpt} ${detailUrl}` }),
    });
    if (!res.ok) {
      console.error(`[NotificationService] Slack error ${res.status}: ${await res.text()}`);
      return false;
    }
    console.log(`[NotificationService] Slack notification sent for: ${category}`);
    return true;
  } catch (err) {
    console.error("[NotificationService] Slack failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Main notification entry point — called after a diagnosis completes.
 */
export async function notify(
  record: BuildRecord,
  result: DiagnosisResult,
): Promise<void> {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  const frontendUrl = process.env.FRONTEND_URL?.trim() || appBaseUrl;

  // Resolve recipient: use the record owner's email, fall back to NOTIFICATION_EMAIL
  let recipientEmail: string | undefined;
  if (record.userId) {
    const user = getUserById(record.userId);
    if (user?.email) recipientEmail = user.email;
  }
  if (!recipientEmail) {
    recipientEmail = process.env.NOTIFICATION_EMAIL?.trim();
  }

  const hasEmail = Boolean(recipientEmail && process.env.RESEND_API_KEY?.trim());
  const hasSlack = Boolean(slackWebhookUrl);

  if (!hasEmail && !hasSlack) return;

  const excerpt = extractFirstSentence(result.explanation);
  const detailUrl = `${frontendUrl}/diagnoses/${record.id}`;

  const promises: Promise<boolean>[] = [];

  if (hasSlack) {
    promises.push(sendSlackNotification(slackWebhookUrl!, result.category, excerpt, detailUrl));
  }

  if (hasEmail) {
    const subject = `🔴 CI/CD Build Failed: ${record.repoName ?? result.category}`;
    const html = `
      <div style="font-family:sans-serif;max-width:600px;padding:24px">
        <h2 style="color:#e74c3c;margin:0 0 16px">🔴 CI/CD Build Failed</h2>
        <p><strong>Repository:</strong> ${record.repoName ?? "unknown"}</p>
        <p><strong>Job:</strong> ${record.jobName ?? "unknown"}</p>
        <p><strong>Failure Category:</strong> ${result.category}</p>
        <p><strong>Summary:</strong> ${excerpt}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
        <p style="color:#7f8c8d;font-size:0.85rem">
          Log in to your
          <a href="${frontendUrl}">CI/CD Failure Doctor dashboard</a>
          to view the full diagnosis and suggested fix.
        </p>
      </div>`;
    const text = [
      `CI/CD Build Failed`,
      `Repository: ${record.repoName ?? "unknown"}`,
      `Job: ${record.jobName ?? "unknown"}`,
      `Category: ${result.category}`,
      `Summary: ${excerpt}`,
      ``,
      `Log in to your CI/CD Failure Doctor dashboard to view the full diagnosis.`,
      frontendUrl,
    ].join("\n");

    promises.push(sendEmail(recipientEmail!, subject, html, text));
  }

  await Promise.allSettled(promises);
}
