/**
 * Unit tests for NotificationService
 *
 * Tests notification delivery to Slack and email channels,
 * error handling, and independence of notification channels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notify } from "../src/services/notificationService.js";
import type { BuildRecord, DiagnosisResult } from "../src/types.js";

// Mock nodemailer
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: "test-id" }),
    })),
  },
}));

describe("NotificationService", () => {
  const mockRecord: BuildRecord = {
    id: "test-uuid-123",
    repoName: "acme/test-repo",
    jobName: "CI / build",
    commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    branch: "main",
    source: "github",
    rawLog: "test log",
    cleanedLog: "cleaned test log",
    truncated: false,
    status: "complete",
    category: "test-failure",
    explanation: "First sentence of explanation. Second sentence here.",
    suggestedFix: "Fix it like this",
    confidence: "high",
    retryCount: 0,
    errorMessage: null,
    createdAt: new Date("2024-01-15T10:00:00Z"),
    completedAt: new Date("2024-01-15T10:00:05Z"),
  };

  const mockResult: DiagnosisResult = {
    category: "test-failure",
    explanation: "First sentence of explanation. Second sentence here.",
    suggestedFix: "Fix it like this",
    confidence: "high",
  };

  let originalEnv: NodeJS.ProcessEnv;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    // Clear console methods to avoid cluttering test output
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("when both notification channels are disabled", () => {
    it("should return immediately without making any calls", async () => {
      delete process.env.SLACK_WEBHOOK_URL;
      delete process.env.NOTIFICATION_EMAIL;

      await notify(mockRecord, mockResult);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("Slack notifications", () => {
    beforeEach(() => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
      process.env.APP_BASE_URL = "https://test-app.com";
      delete process.env.NOTIFICATION_EMAIL;
    });

    it("should POST to Slack webhook with correct format", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "ok",
      });

      await notify(mockRecord, mockResult);

      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.slack.com/test",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.text).toBe(
        "[test-failure] First sentence of explanation. https://test-app.com/diagnoses/test-uuid-123",
      );
    });

    it("should extract first sentence from explanation", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "ok",
      });

      await notify(mockRecord, mockResult);

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.text).toContain("First sentence of explanation.");
      expect(callBody.text).not.toContain("Second sentence");
    });

    it("should handle explanation without sentence terminator", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "ok",
      });

      const resultNoTerminator: DiagnosisResult = {
        ...mockResult,
        explanation: "This is a very long explanation without proper punctuation that goes on and on and should be truncated after 100 characters to avoid overwhelming the notification channel",
      };

      await notify(mockRecord, resultNoTerminator);

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.text.length).toBeLessThan(200); // should be truncated
      expect(callBody.text).toContain("...");
    });

    it("should strip trailing slash from APP_BASE_URL", async () => {
      process.env.APP_BASE_URL = "https://test-app.com/";
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "ok",
      });

      await notify(mockRecord, mockResult);

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.text).toContain("https://test-app.com/diagnoses/");
      expect(callBody.text).not.toContain("//diagnoses");
    });

    it("should use default APP_BASE_URL if not set", async () => {
      delete process.env.APP_BASE_URL;
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "ok",
      });

      await notify(mockRecord, mockResult);

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.text).toContain("http://localhost:3000/diagnoses/");
    });

    it("should log error and continue when Slack returns non-2xx", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      // Should not throw
      await expect(notify(mockRecord, mockResult)).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Slack webhook returned 500"),
      );
    });

    it("should log error and continue when Slack POST fails with network error", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network timeout"));

      // Should not throw
      await expect(notify(mockRecord, mockResult)).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Slack notification failed"),
        "Network timeout",
      );
    });

    it("should not send notification if SLACK_WEBHOOK_URL is empty string", async () => {
      process.env.SLACK_WEBHOOK_URL = "   ";

      await notify(mockRecord, mockResult);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("Email notifications", () => {
    beforeEach(() => {
      process.env.NOTIFICATION_EMAIL = "dev@example.com";
      process.env.APP_BASE_URL = "https://test-app.com";
      process.env.SMTP_HOST = "smtp.test.com";
      process.env.SMTP_PORT = "587";
      process.env.SMTP_USER = "smtp-user@test.com";
      process.env.SMTP_PASS = "test-password";
      delete process.env.SLACK_WEBHOOK_URL;
    });

    it("should send email with correct content", async () => {
      const nodemailer = await import("nodemailer");
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
      (nodemailer.default.createTransport as ReturnType<typeof vi.fn>).mockReturnValue({
        sendMail: mockSendMail,
      });

      await notify(mockRecord, mockResult);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "smtp-user@test.com",
          to: "dev@example.com",
          subject: "CI/CD Failure Diagnosed: test-failure",
          text: expect.stringContaining("First sentence of explanation."),
          html: expect.stringContaining("First sentence of explanation."),
        }),
      );
    });

    it("should include detail URL in email", async () => {
      const nodemailer = await import("nodemailer");
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
      (nodemailer.default.createTransport as ReturnType<typeof vi.fn>).mockReturnValue({
        sendMail: mockSendMail,
      });

      await notify(mockRecord, mockResult);

      const call = mockSendMail.mock.calls[0][0];
      expect(call.text).toContain("https://test-app.com/diagnoses/test-uuid-123");
      expect(call.html).toContain("https://test-app.com/diagnoses/test-uuid-123");
    });

    it("should use default SMTP settings if not provided", async () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.SMTP_USER;

      const nodemailer = await import("nodemailer");
      (nodemailer.default.createTransport as ReturnType<typeof vi.fn>).mockReturnValue({
        sendMail: vi.fn().mockResolvedValue({ messageId: "test-id" }),
      });

      await notify(mockRecord, mockResult);

      expect(nodemailer.default.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "smtp.gmail.com",
          port: 587,
          auth: expect.objectContaining({
            user: "dev@example.com", // defaults to NOTIFICATION_EMAIL
          }),
        }),
      );
    });

    it("should log error and continue when email send fails", async () => {
      const nodemailer = await import("nodemailer");
      (nodemailer.default.createTransport as ReturnType<typeof vi.fn>).mockReturnValue({
        sendMail: vi.fn().mockRejectedValue(new Error("SMTP connection failed")),
      });

      // Should not throw
      await expect(notify(mockRecord, mockResult)).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Email notification failed"),
        "SMTP connection failed",
      );
    });

    it("should not send email if NOTIFICATION_EMAIL is empty string", async () => {
      process.env.NOTIFICATION_EMAIL = "   ";

      const nodemailer = await import("nodemailer");
      const mockCreateTransport = nodemailer.default.createTransport as ReturnType<typeof vi.fn>;
      mockCreateTransport.mockClear();

      await notify(mockRecord, mockResult);

      expect(mockCreateTransport).not.toHaveBeenCalled();
    });
  });

  describe("Independent channel execution", () => {
    beforeEach(() => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
      process.env.NOTIFICATION_EMAIL = "dev@example.com";
      process.env.APP_BASE_URL = "https://test-app.com";
      process.env.SMTP_HOST = "smtp.test.com";
      process.env.SMTP_PASS = "test-password";
    });

    it("should send both notifications when both are configured", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "ok",
      });

      const nodemailer = await import("nodemailer");
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
      (nodemailer.default.createTransport as ReturnType<typeof vi.fn>).mockReturnValue({
        sendMail: mockSendMail,
      });

      await notify(mockRecord, mockResult);

      expect(fetchMock).toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalled();
    });

    it("should send email even if Slack fails", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Slack network error"));

      const nodemailer = await import("nodemailer");
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
      (nodemailer.default.createTransport as ReturnType<typeof vi.fn>).mockReturnValue({
        sendMail: mockSendMail,
      });

      await notify(mockRecord, mockResult);

      expect(mockSendMail).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Slack notification failed"),
        expect.any(String),
      );
    });

    it("should send Slack even if email fails", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "ok",
      });

      const nodemailer = await import("nodemailer");
      (nodemailer.default.createTransport as ReturnType<typeof vi.fn>).mockReturnValue({
        sendMail: vi.fn().mockRejectedValue(new Error("Email send failed")),
      });

      await notify(mockRecord, mockResult);

      expect(fetchMock).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Email notification failed"),
        expect.any(String),
      );
    });

    it("should never throw even if both channels fail", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Slack error"));

      const nodemailer = await import("nodemailer");
      (nodemailer.default.createTransport as ReturnType<typeof vi.fn>).mockReturnValue({
        sendMail: vi.fn().mockRejectedValue(new Error("Email error")),
      });

      // Should not throw
      await expect(notify(mockRecord, mockResult)).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledTimes(2); // once for Slack, once for email
    });
  });
});
