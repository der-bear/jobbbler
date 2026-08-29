import { DomainError } from "@jobbbler/core-domain";

import { canExposeLocalOtp, type RevealableEmailProtector } from "./identity-security";
import type { VerificationDelivery } from "./identity-route-handlers";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

function required(environment: RuntimeEnvironment, name: "RESEND_API_KEY" | "EMAIL_FROM"): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for Resend delivery.`);
  }
  return value;
}

export function createVerificationDelivery(
  environment: RuntimeEnvironment,
  email: RevealableEmailProtector,
  fetcher: typeof fetch = fetch,
): VerificationDelivery {
  const driver = environment["NOTIFICATION_DRIVER"] ?? "capture";
  if (driver === "capture") {
    if (!canExposeLocalOtp(environment)) {
      throw new Error(
        "The capture notification driver is restricted to explicit local or test use.",
      );
    }
    return {
      async deliverVerification() {
        return { delivery: "captured" };
      },
    };
  }
  if (driver !== "resend") throw new Error(`Unsupported notification driver: ${driver}.`);

  const apiKey = required(environment, "RESEND_API_KEY");
  const from = required(environment, "EMAIL_FROM");
  return {
    async deliverVerification(input) {
      const destination = email.reveal(input.encryptedAddress);
      let response: Response;
      try {
        response = await fetcher(RESEND_EMAIL_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "idempotency-key": `verify-${input.challengeId}`,
            "user-agent": "Jobbbler/0.1 (+https://jobbbler.example)",
          },
          body: JSON.stringify({
            from,
            to: [destination],
            subject: "Your Jobbbler verification code",
            text: [
              `Your Jobbbler verification code is ${input.code}.`,
              "",
              `It expires at ${input.expiresAt}.`,
              "If you did not request this code, you can ignore this message.",
            ].join("\n"),
          }),
          signal: AbortSignal.timeout(8_000),
        });
      } catch (cause) {
        throw new DomainError({
          code: "DEPENDENCY",
          message: "Verification email delivery is temporarily unavailable.",
          retryable: true,
          cause,
        });
      }

      if (!response.ok) {
        throw new DomainError({
          code: "DEPENDENCY",
          message: "Verification email delivery failed.",
          retryable: response.status === 429 || response.status >= 500,
          details: { providerStatus: response.status },
        });
      }
      return { delivery: "queued" };
    },
  };
}
