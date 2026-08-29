import { describe, expect, it, vi } from "vitest";

import { createEmailProtector } from "./identity-security";
import { createVerificationDelivery } from "./verification-delivery";

const secrets = {
  NODE_ENV: "test",
  ALLOW_LOCAL_OTP_CAPTURE: "true",
  TOKEN_HASH_SECRET: "token-hash-secret-that-is-long-enough-for-tests",
  PII_ENCRYPTION_KEY: "pii-encryption-secret-that-is-long-enough-for-tests",
};

describe("verification delivery", () => {
  it("captures locally without network or logging personal data", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const delivery = createVerificationDelivery(
      { ...secrets, NOTIFICATION_DRIVER: "capture" },
      createEmailProtector(secrets),
      fetcher,
    );

    await expect(
      delivery.deliverVerification({
        encryptedAddress: "not-needed-by-capture",
        code: "372941",
        expiresAt: "2026-08-29T10:10:00.000Z",
        challengeId: "challenge_550e8400-e29b-41d4-a716-446655440002",
      }),
    ).resolves.toEqual({ delivery: "captured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends a purpose-limited OTP through Resend with delivery idempotency", async () => {
    const email = createEmailProtector(secrets);
    const protectedEmail = email.protect("person@example.com");
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "email_123" }), { status: 200 }),
    );
    const delivery = createVerificationDelivery(
      {
        ...secrets,
        NODE_ENV: "production",
        NOTIFICATION_DRIVER: "resend",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "Jobbbler <identity@jobbbler.example>",
      },
      email,
      fetcher,
    );

    await expect(
      delivery.deliverVerification({
        encryptedAddress: protectedEmail.addressCiphertext,
        code: "372941",
        expiresAt: "2026-08-29T10:10:00.000Z",
        challengeId: "challenge_550e8400-e29b-41d4-a716-446655440002",
      }),
    ).resolves.toEqual({ delivery: "queued" });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer re_test",
          "idempotency-key": "verify-challenge_550e8400-e29b-41d4-a716-446655440002",
          "user-agent": "Jobbbler/0.1 (+https://jobbbler.example)",
        }),
      }),
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: "Jobbbler <identity@jobbbler.example>",
      to: ["person@example.com"],
      subject: "Your Jobbbler verification code",
    });
    expect(String(body["text"])).toContain("372941");
    expect(JSON.stringify(body)).not.toContain(protectedEmail.addressCiphertext);
  });

  it("fails closed on production capture and classifies retryable provider failures", async () => {
    expect(() =>
      createVerificationDelivery(
        { ...secrets, NODE_ENV: "production", NOTIFICATION_DRIVER: "capture" },
        createEmailProtector(secrets),
      ),
    ).toThrow("capture");

    const email = createEmailProtector(secrets);
    const delivery = createVerificationDelivery(
      {
        ...secrets,
        NODE_ENV: "production",
        NOTIFICATION_DRIVER: "resend",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "Jobbbler <identity@jobbbler.example>",
      },
      email,
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );

    await expect(
      delivery.deliverVerification({
        encryptedAddress: email.protect("person@example.com").addressCiphertext,
        code: "372941",
        expiresAt: "2026-08-29T10:10:00.000Z",
        challengeId: "challenge_550e8400-e29b-41d4-a716-446655440002",
      }),
    ).rejects.toMatchObject({ code: "DEPENDENCY", retryable: true });
  });

  it("rejects capture on a deployed development preview", () => {
    expect(() =>
      createVerificationDelivery(
        {
          ...secrets,
          NODE_ENV: "development",
          PUBLIC_BASE_URL: "https://preview.jobbbler.example",
          NOTIFICATION_DRIVER: "capture",
        },
        createEmailProtector(secrets),
      ),
    ).toThrow("explicit local");
  });
});
