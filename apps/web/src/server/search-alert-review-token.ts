import { createHmac, timingSafeEqual } from "node:crypto";

import {
  entityIdSchema,
  isoInstantSchema,
  jobSearchCriteriaSchema,
  scheduleRecurrenceSchema,
} from "@jobbbler/contracts";
import { DomainError } from "@jobbbler/core-domain";
import { z } from "zod";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const TOKEN_DOMAIN = "jobbbler:search-alert-review:v1";
const LOCAL_SIGNING_SECRET = "jobbbler-local-search-alert-review-change-before-production";
const SECRET_MINIMUM_LENGTH = 32;
const MAX_TOKEN_LIFETIME_MS = 15 * 60 * 1_000;
const ENCODED_PAYLOAD_MAX_LENGTH = 3_000;
const TOKEN_PATTERN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/u;

export const searchAlertReviewPayloadSchema = z.strictObject({
  version: z.literal(1),
  purpose: z.literal("search_alert_activation"),
  ownerId: entityIdSchema,
  requestId: entityIdSchema,
  savedSearchId: entityIdSchema,
  savedSearchVersion: z.number().int().nonnegative(),
  criteria: jobSearchCriteriaSchema,
  endpointId: entityIdSchema,
  challengeId: entityIdSchema,
  scheduleId: entityIdSchema,
  recurrence: scheduleRecurrenceSchema,
  firstRunAt: isoInstantSchema,
  privacyNoticeVersion: z.string().trim().min(1).max(40),
  issuedAt: isoInstantSchema,
  expiresAt: isoInstantSchema,
});

export type SearchAlertReviewPayload = z.infer<typeof searchAlertReviewPayloadSchema>;

function signingSecret(environment: RuntimeEnvironment): string {
  const configured = environment["TOKEN_HASH_SECRET"];
  if (configured !== undefined && configured.length >= SECRET_MINIMUM_LENGTH) return configured;
  if (environment["NODE_ENV"] !== "production") return LOCAL_SIGNING_SECRET;
  throw new Error(
    `TOKEN_HASH_SECRET must contain at least ${String(SECRET_MINIMUM_LENGTH)} characters.`,
  );
}

function invalidReview(): DomainError {
  return new DomainError({
    code: "UNAUTHORIZED",
    message: "The search alert review is invalid, expired, or belongs to another private session.",
  });
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError("Expected a valid ISO instant.");
  return parsed;
}

function assertLifetime(payload: SearchAlertReviewPayload): void {
  const issuedAt = instant(payload.issuedAt);
  const expiresAt = instant(payload.expiresAt);
  const lifetime = expiresAt - issuedAt;
  if (lifetime <= 0) throw new TypeError("Search alert review expiry must follow its issue time.");
  if (lifetime > MAX_TOKEN_LIFETIME_MS) {
    throw new TypeError("Search alert review lifetime cannot exceed 15 minutes.");
  }
}

function signature(secret: string, encodedPayload: string): Buffer {
  return createHmac("sha256", secret)
    .update(TOKEN_DOMAIN)
    .update("\u0000")
    .update(encodedPayload)
    .digest();
}

function hasValidSignature(
  secret: string,
  encodedPayload: string,
  encodedSignature: string,
): boolean {
  const expected = signature(secret, encodedPayload);
  const syntacticallyValid = /^[A-Za-z0-9_-]{43}$/u.test(encodedSignature);
  const decoded = syntacticallyValid
    ? Buffer.from(encodedSignature, "base64url")
    : Buffer.alloc(expected.length);
  const comparable = decoded.length === expected.length ? decoded : Buffer.alloc(expected.length);
  return (
    timingSafeEqual(expected, comparable) &&
    syntacticallyValid &&
    decoded.length === expected.length
  );
}

export function createSearchAlertReviewCodec(environment: RuntimeEnvironment = process.env): {
  sign(payload: SearchAlertReviewPayload): string;
  authenticate(token: string, expectedOwnerId: string): SearchAlertReviewPayload;
  verify(token: string, expectedOwnerId: string, now: string): SearchAlertReviewPayload;
} {
  const secret = signingSecret(environment);
  function authenticate(token: string, expectedOwnerId: string): SearchAlertReviewPayload {
    try {
      if (token.length > 4_096) throw invalidReview();
      const match = TOKEN_PATTERN.exec(token);
      if (match === null) throw invalidReview();
      const encodedPayload = match[1]!;
      const encodedSignature = match[2]!;
      if (
        encodedPayload.length > ENCODED_PAYLOAD_MAX_LENGTH ||
        !hasValidSignature(secret, encodedPayload, encodedSignature)
      ) {
        throw invalidReview();
      }
      const payload = searchAlertReviewPayloadSchema.parse(
        JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
      );
      assertLifetime(payload);
      if (payload.ownerId !== expectedOwnerId) throw invalidReview();
      return payload;
    } catch {
      throw invalidReview();
    }
  }
  return {
    sign(rawPayload) {
      const payload = searchAlertReviewPayloadSchema.parse(rawPayload);
      assertLifetime(payload);
      const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      if (encodedPayload.length > ENCODED_PAYLOAD_MAX_LENGTH) {
        throw new TypeError("Search alert review payload is too large.");
      }
      return `${encodedPayload}.${signature(secret, encodedPayload).toString("base64url")}`;
    },
    authenticate,
    verify(token, expectedOwnerId, now) {
      try {
        const payload = authenticate(token, expectedOwnerId);
        const nowMs = instant(now);
        if (instant(payload.issuedAt) > nowMs || instant(payload.expiresAt) <= nowMs) {
          throw invalidReview();
        }
        return payload;
      } catch {
        throw invalidReview();
      }
    },
  };
}
