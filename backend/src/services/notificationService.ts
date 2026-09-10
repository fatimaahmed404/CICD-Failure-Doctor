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
import nodemailer from "nodemailer";
import { getUserById } from "../db/users.js";

function extractFirstSentence(text: string): string {
  const match = text.match(/^[^.!?]+[.!?]/);
  if (match) return match[0].trim();
  return text.length > 100 ? text.slice(0, 100) + "..." : text;
}

/** Create a nodemailer transporter using Resend's SMTP relay. */
function createTransporter() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;

  return nodemailer.createTransport({
    host: "smtp.resend.com",
    port: 465,
    secure: true, // SSL on port 465
    auth: {
      user: "resend",       // always "resend" for Resend SMTP
      pass: apiKey,
    },
  });
}

async function sendEmailNotification(
  toAddress: string,
  repoName: string,
  jobName: string,
  category: string,
  excerpt: string,
  frontendUrl: string,
): Promise<boolean> {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn("[NotificationService] RESEND_API_KEY not set — skipping email");
    return false;
  }

  // Resend requires a from address on a verified domain.
  // Use RESEND_FROM_EMAIL if set, otherwise fall back to onboarding@resend.dev
  // (only works when sending to the Resend account owner's email).
  const fromAddress = process.env.RESEND_FROM_EMAIL?.trim()
    || "CI/CD Doctor <onboarding@resend.dev>";

  const subject = `🔴 Build Failed: ${repoName}`;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;padding:24px;border:1px solid #eee;border-radius:8px">
      <h2 style="color:#e74c3c;margin:0 0 20px">🔴 CI/CD Build Failed</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:8px 0;color:#666;width:120px"><strong>Repository</strong></td>
          <td style="padding:8px 0">${repoName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#666"><strong>Job</strong></td>
          <td style="padding:8px 0">${jobName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#666"><strong>Category</strong></td>
          <td style="padding:8px 0">${category}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#666;vertical-align:top"><strong>Summary</strong></td>
          <td style="padding:8px 0">${excerpt}</td>
        </tr>
      </table>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
      <p style="color:#7f8c8d;font-size:0.85rem;margin:0">
        Log in to your
        <a href="${frontendUrl}" style="color:#3498db">CI/CD Failure Doctor dashboard</a>
        to view the full diagnosis and suggested fix.
      </p>
    </div>`;

  const text = [
    `CI/CD Build Failed`,
    ``,
    `Repository: ${repoName}`,
    `Job:        ${jobName}`,
    `Category:   ${category}`,
    `Summary:    ${excerpt}`,
    ``,
    `Log in to view the full diagnosis: ${frontendUrl}`,
  ].join("\n");

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: toAddress,
      subject,
      text,
      html,
    });
    console.log(`[NotificationService] Email sent to ${toAddress} — messageId: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error(
      "[NotificationService] Email failed:",
      err instanceof Error ? err.message : String(err),
    );
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

export async function notify(
  record: BuildRecord,
  result: DiagnosisResult,
): Promise<void> {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  const frontendUrl = process.env.FRONTEND_URL?.trim() || appBaseUrl;

  // Resolve recipient email — use the build owner's account email,
  // fall back to NOTIFICATION_EMAIL for anonymous/demo records.
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
    promises.push(
      sendEmailNotification(
        recipientEmail!,
        record.repoName ?? "unknown",
        record.jobName ?? "unknown",
        result.category,
        excerpt,
        frontendUrl,
      ),
    );
  }

  await Promise.allSettled(promises);
}
