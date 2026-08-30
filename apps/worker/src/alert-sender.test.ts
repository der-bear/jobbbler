import { createCipheriv, createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { DomainError } from "@jobbbler/core-domain";

import { createAlertDeliverySender } from "./alert-sender.js";

const key = "worker-test-pii-encryption-key-that-is-long-enough";

function encryptAddress(address: string): string {
  const encryptionKey = createHash("sha256").update("jobbbler:email:v1\u0000").update(key).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAAD(Buffer.from("jobbbler:email:v1", "utf8"));
  const encrypted = Buffer.concat([cipher.update(address, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

const message = {
  deliveryId: "delivery_550e8400-e29b-41d4-a716-446655440000",
  endpointId: "endpoint_550e8400-e29b-41d4-a716-446655440000",
  encryptedAddress: encryptAddress("person@example.com"),
  contentHash: "a".repeat(64),
  subject: "Your Jobbbler job update",
  text: "One job update is ready.",
};

describe("alert delivery sender", () => {
  it("decrypts the AES-GCM envelope only for a Resend request with idempotency and timeout", async () => {
    let request: RequestInit | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      request = init;
      return Response.json({ id: "resend_alert_1" }, { status: 201 });
    };
    const sender = createAlertDeliverySender(
      {
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://jobs.example.org",
        NOTIFICATION_DRIVER: "resend",
        PII_ENCRYPTION_KEY: key,
        RESEND_API_KEY: "re_test_secret",
        EMAIL_FROM: "Jobbbler <alerts@jobbbler.example>",
      },
      fetcher,
    );

    await expect(sender.send(message)).resolves.toEqual({ providerRef: "resend_alert_1" });
    expect(request).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "idempotency-key": "alert-delivery_550e8400-e29b-41d4-a716-446655440000",
        "user-agent": "Jobbbler/0.1 (+https://jobs.example.org)",
      }),
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      to: ["person@example.com"],
      subject: message.subject,
      text: message.text,
    });
  });

  it("allows capture only with an explicit local or test opt-in", async () => {
    const captured = createAlertDeliverySender({
      NODE_ENV: "test",
      NOTIFICATION_DRIVER: "capture",
      ALLOW_LOCAL_OTP_CAPTURE: "true",
      PII_ENCRYPTION_KEY: key,
    });
    await expect(captured.send(message)).resolves.toEqual({
      providerRef: "capture_delivery_550e8400-e29b-41d4-a716-446655440000",
    });
    expect(() =>
      createAlertDeliverySender({
        NODE_ENV: "test",
        NOTIFICATION_DRIVER: "capture",
        PII_ENCRYPTION_KEY: key,
      }),
    ).toThrow("restricted");
  });

  it("returns a safe retryable error for a transient provider response", async () => {
    const sender = createAlertDeliverySender(
      {
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://jobs.example.org",
        NOTIFICATION_DRIVER: "resend",
        PII_ENCRYPTION_KEY: key,
        RESEND_API_KEY: "re_test_secret",
        EMAIL_FROM: "Jobbbler <alerts@jobbbler.example>",
      },
      async () => new Response("unavailable", { status: 503 }),
    );

    await expect(sender.send(message)).rejects.toEqual(
      expect.objectContaining<Partial<DomainError>>({ code: "DEPENDENCY", retryable: true }),
    );
  });

  it("rejects missing production origin before accepting alert work", () => {
    expect(() =>
      createAlertDeliverySender({
        NODE_ENV: "production",
        NOTIFICATION_DRIVER: "resend",
        PII_ENCRYPTION_KEY: key,
        RESEND_API_KEY: "re_test_secret",
        EMAIL_FROM: "Jobbbler <alerts@jobbbler.example>",
      }),
    ).toThrow("PUBLIC_BASE_URL");
  });
});
