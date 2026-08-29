import { createDecipheriv, createHash } from "node:crypto";

import { DomainError } from "@jobbbler/core-domain";

import type { AlertDeliverySender } from "./alert-worker.js";

const EMAIL_AAD = "jobbbler:email:v1";
const RESEND_URL = "https://api.resend.com/emails";
const RESEND_USER_AGENT = "Jobbbler/0.1 (+https://jobbbler.example)";
const RESEND_TIMEOUT_MS = 8_000;

type Environment = Readonly<Record<string, string | undefined>>;

interface ResendResponse {
  readonly id?: unknown;
}

function requiredPiiSecret(environment: Environment): string {
  const value = environment["PII_ENCRYPTION_KEY"];
  if (!value || value.length < 32) {
    throw new DomainError({
      code: "VALIDATION",
      message: "PII_ENCRYPTION_KEY must be configured with at least 32 characters.",
      retryable: false,
    });
  }

  return value;
}

function decryptAddress(envelope: string, secret: string): string {
  const [encodedIv, encodedTag, encodedCiphertext, ...extra] = envelope.split(".");
  if (!encodedIv || !encodedTag || !encodedCiphertext || extra.length > 0) {
    throw new DomainError({
      code: "VALIDATION",
      message: "The email address envelope is malformed.",
      retryable: false,
    });
  }

  try {
    const key = createHash("sha256").update("jobbbler:email:v1\u0000").update(secret).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
    decipher.setAAD(Buffer.from(EMAIL_AAD, "utf8"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");

    if (!plaintext || plaintext.length > 320) {
      throw new Error("Invalid plaintext length");
    }

    return plaintext;
  } catch {
    throw new DomainError({
      code: "VALIDATION",
      message: "The email address envelope cannot be decrypted.",
      retryable: false,
    });
  }
}

function captureAllowed(environment: Environment): boolean {
  if (environment["ALLOW_LOCAL_OTP_CAPTURE"] !== "true") {
    return false;
  }

  if (environment["NODE_ENV"] === "test") {
    return true;
  }

  if (environment["NODE_ENV"] !== "development") {
    return false;
  }

  try {
    const hostname = new URL(environment["PUBLIC_BASE_URL"] ?? "http://localhost").hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function dependencyError(status: number | undefined): DomainError {
  return new DomainError({
    code: "DEPENDENCY",
    message: "The alert email provider could not accept this delivery.",
    retryable: status === undefined || status === 429 || status >= 500,
  });
}

export function createAlertDeliverySender(
  environment: Environment = process.env,
  fetcher: typeof fetch = fetch,
): AlertDeliverySender {
  const driver = environment["NOTIFICATION_DRIVER"] ?? "resend";

  if (driver === "capture") {
    if (!captureAllowed(environment)) {
      throw new DomainError({
        code: "FORBIDDEN",
        message:
          "Local notification capture is restricted to explicitly enabled local or test environments.",
        retryable: false,
      });
    }

    return {
      async send(input) {
        return { providerRef: `capture_${input.deliveryId}` };
      },
    };
  }

  if (driver !== "resend") {
    throw new DomainError({
      code: "VALIDATION",
      message: "NOTIFICATION_DRIVER must be resend or capture.",
      retryable: false,
    });
  }

  const apiKey = environment["RESEND_API_KEY"];
  if (!apiKey) {
    throw new DomainError({
      code: "VALIDATION",
      message: "RESEND_API_KEY must be configured for Resend alert delivery.",
      retryable: false,
    });
  }
  const from = environment["EMAIL_FROM"];
  if (!from) {
    throw new DomainError({
      code: "VALIDATION",
      message: "EMAIL_FROM must be configured for Resend alert delivery.",
      retryable: false,
    });
  }
  const piiEncryptionKey = requiredPiiSecret(environment);

  return {
    async send(input) {
      const address = decryptAddress(input.encryptedAddress, piiEncryptionKey);
      let response: Response;

      try {
        response = await fetcher(RESEND_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "idempotency-key": `alert-${input.deliveryId}`,
            "user-agent": RESEND_USER_AGENT,
          },
          body: JSON.stringify({
            from,
            to: [address],
            subject: input.subject,
            text: input.text,
          }),
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        });
      } catch {
        throw dependencyError(undefined);
      }

      if (!response.ok) {
        throw dependencyError(response.status);
      }

      let payload: ResendResponse = {};
      try {
        payload = (await response.json()) as ResendResponse;
      } catch {
        // A successful provider response without a body is still an accepted delivery.
      }

      return { providerRef: typeof payload.id === "string" ? payload.id : null };
    },
  };
}
