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
const TOKEN_VERSION = "r1";
const TOKEN_PATTERN = /^r1\.([a-z0-9]{1,13})\.([A-Za-z0-9_-]{43})$/u;

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
  deliveryVerificationRequired: z.boolean(),
  scheduleId: entityIdSchema,
  recurrence: scheduleRecurrenceSchema,
  firstRunAt: isoInstantSchema,
  privacyNoticeVersion: z.string().trim().min(1).max(40),
  issuedAt: isoInstantSchema,
  expiresAt: isoInstantSchema,
});

export type SearchAlertReviewPayload = z.infer<typeof searchAlertReviewPayloadSchema>;

export interface SearchAlertReviewTokenBinding {
  readonly ownerId: string;
  readonly requestId: string;
  readonly expiresAt: string;
}

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

function encodedExpiry(expiresAt: string): string {
  return instant(expiresAt).toString(36);
}

function decodedExpiry(value: string): string {
  const parsed = Number.parseInt(value, 36);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw invalidReview();
  return new Date(parsed).toISOString();
}

function signature(secret: string, binding: SearchAlertReviewTokenBinding): Buffer {
  return createHmac("sha256", secret)
    .update(TOKEN_DOMAIN)
    .update("\u0000")
    .update(JSON.stringify(binding))
    .digest();
}

function hasValidSignature(
  secret: string,
  binding: SearchAlertReviewTokenBinding,
  encodedSignature: string,
): boolean {
  const expected = signature(secret, binding);
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
  authenticate(
    token: string,
    expectedOwnerId: string,
    expectedRequestId: string,
  ): SearchAlertReviewTokenBinding;
  verify(
    token: string,
    expectedOwnerId: string,
    expectedRequestId: string,
    expectedExpiresAt: string,
    now: string,
  ): SearchAlertReviewTokenBinding;
} {
  const secret = signingSecret(environment);
  function authenticate(
    token: string,
    expectedOwnerId: string,
    expectedRequestId: string,
  ): SearchAlertReviewTokenBinding {
    try {
      const match = TOKEN_PATTERN.exec(token);
      if (match === null) throw invalidReview();
      const binding: SearchAlertReviewTokenBinding = {
        ownerId: entityIdSchema.parse(expectedOwnerId),
        requestId: entityIdSchema.parse(expectedRequestId),
        expiresAt: decodedExpiry(match[1]!),
      };
      if (!hasValidSignature(secret, binding, match[2]!)) throw invalidReview();
      return binding;
    } catch {
      throw invalidReview();
    }
  }
  return {
    sign(rawPayload) {
      const payload = searchAlertReviewPayloadSchema.parse(rawPayload);
      assertLifetime(payload);
      const binding: SearchAlertReviewTokenBinding = {
        ownerId: payload.ownerId,
        requestId: payload.requestId,
        expiresAt: payload.expiresAt,
      };
      return `${TOKEN_VERSION}.${encodedExpiry(payload.expiresAt)}.${signature(secret, binding).toString("base64url")}`;
    },
    authenticate,
    verify(token, expectedOwnerId, expectedRequestId, expectedExpiresAt, now) {
      try {
        const binding = authenticate(token, expectedOwnerId, expectedRequestId);
        if (binding.expiresAt !== isoInstantSchema.parse(expectedExpiresAt)) {
          throw invalidReview();
        }
        const nowMs = instant(now);
        if (instant(binding.expiresAt) <= nowMs) throw invalidReview();
        return binding;
      } catch {
        throw invalidReview();
      }
    },
  };
}
