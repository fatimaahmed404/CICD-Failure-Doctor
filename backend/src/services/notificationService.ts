/**
 * Notification Service
 *
 * Sends email via Resend REST API (HTTPS/443) — works on all platforms
 * including Render free tier where SMTP ports are blocked.
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

async function sendEmail(
  toAddress: string,
  repoName: string,
  jobName: string,
  category: string,
  excerpt: string,
  frontendUrl: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[NotificationService] RESEND_API_KEY not set — skipping email");
    return false;
  }

  const fromAddress = process.env.RESEND_FROM_EMAIL?.trim()
    || "CI/CD Doctor <onboarding@resend.dev>";

  const subject = `🔴 Build Failed: ${repoName}`;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;padding:24px;border:1px solid #eee;border-radius:8px">
      <h2 style="color:#e74c3c;margin:0 0 20px">🔴 CI/CD Build Failed</h2>
      <p><strong>Repository:</strong> ${repoName}</p>
      <p><strong>Job:</strong> ${jobName}</p>
      <p><strong>Category:</strong> ${category}</p>
      <p><strong>Summary:</strong> ${excerpt}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
      <p style="color:#7f8c8d;font-size:0.85rem">
        Log in to your <a href="${frontendUrl}" style="color:#3498db">CI/CD Failure Doctor dashboard</a>
        to view the full diagnosis and fix.
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
    console.log(`[NotificationService] Sending email to ${toAddress} via Resend API...`);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromAddress, to: toAddress, subject, html, text }),
    });

    const body = await r.json() as { id?: string; name?: string; message?: string };

    if (!r.ok) {
      console.error(`[NotificationService] Resend API error ${r.status}:`, body);
      return false;
    }

    console.log(`[NotificationService] Email sent to ${toAddress} — id: ${body.id}`);
    return true;
  } catch (err) {
    console.error("[NotificationService] Email send failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function sendSlackNotification(
  webhookUrl: string,
  category: string,
  excerpt: string,
  detailUrl: string,
): Promise<boolean> {
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
  } catch (err) {
    console.error("[NotificationService] Slack failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

export async function notify(
  record: BuildRecord,
  result: DiagnosisResult,
): Promise<void> {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  const frontendUrl = process.env.FRONTEND_URL?.trim() || appBaseUrl;

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

  console.log("[NotificationService] notify():", {
    recordId: record.id,
    userId: record.userId,
    recipientEmail: recipientEmail ?? "none",
    hasResendKey: Boolean(process.env.RESEND_API_KEY?.trim()),
    hasEmail,
    hasSlack,
  });

  if (!hasEmail && !hasSlack) {
    console.warn("[NotificationService] No channels configured — skipping");
    return;
  }

  const excerpt = extractFirstSentence(result.explanation);
  const detailUrl = `${frontendUrl}/diagnoses/${record.id}`;
  const promises: Promise<boolean>[] = [];

  if (hasSlack) {
    promises.push(sendSlackNotification(slackWebhookUrl!, result.category, excerpt, detailUrl));
  }

  if (hasEmail) {
    promises.push(sendEmail(
      recipientEmail!,
      record.repoName ?? "unknown",
      record.jobName ?? "unknown",
      result.category,
      excerpt,
      frontendUrl,
    ));
  }

  await Promise.allSettled(promises);
}
