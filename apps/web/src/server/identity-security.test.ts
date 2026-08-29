import { describe, expect, it } from "vitest";

import {
  assertTrustedMutationOrigin,
  canExposeLocalOtp,
  createEmailProtector,
  createSecretCodec,
  ownerSessionCookie,
  sensitiveRateLimitKey,
} from "./identity-security";

const environment = {
  NODE_ENV: "test",
  PUBLIC_BASE_URL: "https://jobbbler.example",
  TOKEN_HASH_SECRET: "token-hash-secret-that-is-long-enough-for-tests",
  PII_ENCRYPTION_KEY: "pii-encryption-secret-that-is-long-enough-for-tests",
};

describe("identity security adapters", () => {
  it("creates random-looking secrets and purpose-separated one-way hashes", () => {
    const secrets = createSecretCodec(environment);
    const token = secrets.createSessionToken();
    const code = secrets.createVerificationCode();

    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(code).toMatch(/^\d{6}$/);
    expect(secrets.hash("owner_session", token)).toHaveLength(64);
    expect(secrets.hash("owner_session", token)).not.toContain(token);
    expect(secrets.hash("owner_session", token)).not.toBe(
      secrets.hash("email_verification", token),
    );
  });

  it("encrypts normalized email addresses with randomized authenticated encryption", () => {
    const email = createEmailProtector(environment);
    const first = email.protect("Person@Example.com");
    const second = email.protect("person@example.com");

    expect(first.normalized).toBe("person@example.com");
    expect(first.addressHash).toBe(second.addressHash);
    expect(first.addressCiphertext).not.toBe(second.addressCiphertext);
    expect(first.addressCiphertext).not.toContain("person@example.com");
    expect(first.maskedAddress).toBe("p•••••@example.com");
    expect(email.reveal(first.addressCiphertext)).toBe("person@example.com");
    expect(() => email.reveal(`${first.addressCiphertext.slice(0, -2)}aa`)).toThrow();
  });

  it("fails closed when production secrets are missing or weak", () => {
    expect(() => createSecretCodec({ NODE_ENV: "production", TOKEN_HASH_SECRET: "short" })).toThrow(
      "TOKEN_HASH_SECRET",
    );
    expect(() =>
      createEmailProtector({ NODE_ENV: "production", PII_ENCRYPTION_KEY: "short" }),
    ).toThrow("PII_ENCRYPTION_KEY");
  });

  it("requires browser mutations to originate from the configured first-party origin", () => {
    const request = new Request("https://jobbbler.example/api/v1/owners/session", {
      method: "POST",
      headers: { origin: "https://jobbbler.example", "sec-fetch-site": "same-origin" },
    });
    expect(() => assertTrustedMutationOrigin(request, environment)).not.toThrow();

    const crossOrigin = new Request("https://jobbbler.example/api/v1/owners/session", {
      method: "POST",
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    });
    expect(() => assertTrustedMutationOrigin(crossOrigin, environment)).toThrow();

    const missingOrigin = new Request("https://jobbbler.example/api/v1/owners/session", {
      method: "POST",
    });
    expect(() => assertTrustedMutationOrigin(missingOrigin, environment)).toThrow();
  });

  it("uses an opaque HttpOnly same-site cookie with bounded lifetime", () => {
    expect(
      ownerSessionCookie("opaque-secret", "2026-09-05T10:00:00.000Z", {
        NODE_ENV: "production",
      }),
    ).toEqual({
      name: "__Host-jobbbler_owner",
      value: "opaque-secret",
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        expires: new Date("2026-09-05T10:00:00.000Z"),
        priority: "high",
      },
    });
  });

  it("purpose-separates rate-limit keys and exposes capture only in explicit local mode", () => {
    expect(sensitiveRateLimitKey("owner", "person@example.com", environment)).not.toBe(
      sensitiveRateLimitKey("address", "person@example.com", environment),
    );
    expect(
      canExposeLocalOtp({
        NODE_ENV: "development",
        PUBLIC_BASE_URL: "http://localhost:3000",
        ALLOW_LOCAL_OTP_CAPTURE: "true",
      }),
    ).toBe(true);
    expect(
      canExposeLocalOtp({
        NODE_ENV: "development",
        PUBLIC_BASE_URL: "https://preview.jobbbler.example",
        ALLOW_LOCAL_OTP_CAPTURE: "true",
      }),
    ).toBe(false);
  });
});
