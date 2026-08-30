import {
  completeOwnerDeletionInputSchema,
  completeOwnerRecoveryInputSchema,
  createOwnerDeletionIntentInputSchema,
  completeEmailVerificationInputSchema,
  startOwnerRecoveryInputSchema,
  startEmailVerificationInputSchema,
  type OwnerSummary,
} from "@jobbbler/contracts";

import { DomainError } from "../errors.js";
import type {
  EmailProtector,
  IdentityIdFactory,
  IdentityStore,
  OwnerIdentityRecord,
  SecretCodec,
  VerificationChallengePurpose,
} from "./types.js";

const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_CHALLENGE_TTL_SECONDS = 10 * 60;
const DEFAULT_DELETION_INTENT_TTL_SECONDS = 5 * 60;
const DEFAULT_MAX_CHALLENGE_ATTEMPTS = 5;

export interface IdentityServiceOptions {
  readonly store: IdentityStore;
  readonly ids: IdentityIdFactory;
  readonly secrets: SecretCodec;
  readonly email: EmailProtector;
  readonly sessionTtlSeconds?: number;
  readonly challengeTtlSeconds?: number;
  readonly maxChallengeAttempts?: number;
  readonly recoveryChallengeTtlSeconds?: number;
  readonly deletionIntentTtlSeconds?: number;
}

export interface CreatedOwnerSession {
  readonly owner: OwnerIdentityRecord;
  readonly sessionId: string;
  readonly rawToken: string;
  readonly expiresAt: string;
}

export interface StartedEmailVerification {
  readonly challengeId: string;
  readonly endpointId: string;
  readonly rawCode: string;
  readonly expiresAt: string;
  readonly maskedAddress: string;
  readonly encryptedAddress: string;
}

export type PreparedSearchAlertEmailVerification =
  | (StartedEmailVerification & {
      readonly verificationRequired: true;
    })
  | {
      readonly verificationRequired: false;
      readonly challengeId: string;
      readonly endpointId: string;
      readonly rawCode: null;
      readonly expiresAt: string;
      readonly maskedAddress: string;
      readonly encryptedAddress: null;
    };

export interface StableSearchAlertVerificationContext {
  readonly endpointId: string;
  readonly challengeId: string;
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new DomainError({ code: "VALIDATION", message: "Expected a valid ISO instant." });
  }
  return parsed;
}

function after(now: string, seconds: number): string {
  return new Date(instant(now) + seconds * 1_000).toISOString();
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be an integer between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
  return value;
}

export function ownerSummary(owner: OwnerIdentityRecord): OwnerSummary {
  return {
    id: owner.id,
    kind: owner.kind,
    verified: owner.verified,
    recoverable: owner.verified && (owner.kind === "guest" || owner.kind === "user"),
  };
}

export function createIdentityService(options: IdentityServiceOptions) {
  const sessionTtlSeconds = boundedInteger(
    options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS,
    300,
    30 * 24 * 60 * 60,
    "Session TTL",
  );
  const challengeTtlSeconds = boundedInteger(
    options.challengeTtlSeconds ?? DEFAULT_CHALLENGE_TTL_SECONDS,
    60,
    60 * 60,
    "Verification challenge TTL",
  );
  const maxChallengeAttempts = boundedInteger(
    options.maxChallengeAttempts ?? DEFAULT_MAX_CHALLENGE_ATTEMPTS,
    1,
    10,
    "Verification challenge attempts",
  );
  const recoveryChallengeTtlSeconds = boundedInteger(
    options.recoveryChallengeTtlSeconds ?? DEFAULT_CHALLENGE_TTL_SECONDS,
    60,
    60 * 60,
    "Recovery challenge TTL",
  );
  const deletionIntentTtlSeconds = boundedInteger(
    options.deletionIntentTtlSeconds ?? DEFAULT_DELETION_INTENT_TTL_SECONDS,
    60,
    15 * 60,
    "Deletion intent TTL",
  );

  async function startEmailVerification(
    ownerId: string,
    rawInput: unknown,
    now: string,
    purpose: VerificationChallengePurpose,
    stableContext?: StableSearchAlertVerificationContext,
  ): Promise<StartedEmailVerification> {
    const input = startEmailVerificationInputSchema.parse(rawInput);
    const protectedEmail = options.email.protect(input.email);
    const endpointId = stableContext?.endpointId ?? options.ids.endpoint();
    const challengeId = stableContext?.challengeId ?? options.ids.challenge();
    const rawCode =
      purpose === "search_alert_review"
        ? options.secrets.deriveSearchAlertVerificationCode(challengeId)
        : options.secrets.createVerificationCode();
    if (!/^\d{6}$/.test(rawCode)) {
      throw new Error("Verification code source must return exactly six digits.");
    }
    const expiresAt = after(now, challengeTtlSeconds);
    const stored = await options.store.beginEmailVerification({
      endpoint: {
        id: endpointId,
        ownerId,
        kind: "email",
        addressHash: protectedEmail.addressHash,
        addressCiphertext: protectedEmail.addressCiphertext,
        maskedAddress: protectedEmail.maskedAddress,
        status: "pending",
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      challenge: {
        id: challengeId,
        ownerId,
        endpointId,
        purpose,
        tokenHash: options.secrets.hash("email_verification", `${challengeId}\u0000${rawCode}`),
        status: "pending",
        attempts: 0,
        maxAttempts: maxChallengeAttempts,
        expiresAt,
        consumedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      challengeId: stored.challenge.id,
      endpointId: stored.endpoint.id,
      rawCode,
      expiresAt: stored.challenge.expiresAt,
      maskedAddress: stored.endpoint.maskedAddress,
      encryptedAddress: stored.endpoint.addressCiphertext,
    };
  }

  async function completeEmailVerification(
    ownerId: string,
    rawInput: unknown,
    now: string,
    purpose: VerificationChallengePurpose,
    acceptConsumed: boolean,
  ) {
    const input = completeEmailVerificationInputSchema.parse(rawInput);
    const result = await options.store.consumeEmailVerification({
      ownerId,
      challengeId: input.challengeId,
      tokenHash: options.secrets.hash(
        "email_verification",
        `${input.challengeId}\u0000${input.code}`,
      ),
      now,
      expectedPurpose: purpose,
      acceptConsumed,
    });
    if (result.status === "verified") {
      return {
        owner: ownerSummary(result.owner),
        endpointId: result.endpoint.id,
        verifiedAt: result.endpoint.verifiedAt ?? now,
      };
    }
    if (result.status === "invalid") {
      throw new DomainError({
        code: "UNAUTHORIZED",
        message: "The verification code is invalid.",
        details: { remainingAttempts: result.remainingAttempts },
      });
    }
    throw new DomainError({
      code: "CONFLICT",
      message:
        result.status === "expired"
          ? "The verification code expired. Request a new code."
          : result.status === "locked"
            ? "Too many verification attempts. Request a new code."
            : "The verification code has already been used.",
    });
  }

  return {
    async createEphemeralSession(now: string): Promise<CreatedOwnerSession> {
      const rawToken = options.secrets.createSessionToken();
      if (rawToken.length < 32)
        throw new Error("Session token source returned insufficient entropy.");
      const ownerId = options.ids.owner();
      const sessionId = options.ids.session();
      const expiresAt = after(now, sessionTtlSeconds);
      const owner: OwnerIdentityRecord = {
        id: ownerId,
        kind: "ephemeral",
        verified: false,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      const stored = await options.store.createOwnerWithSession({
        owner,
        session: {
          id: sessionId,
          ownerId,
          tokenHash: options.secrets.hash("owner_session", rawToken),
          status: "active",
          expiresAt,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });
      return { owner: stored.owner, sessionId, rawToken, expiresAt };
    },

    async resolveSession(rawToken: string | null, now: string) {
      if (rawToken === null || rawToken.length < 32) return null;
      return options.store.resolveSession(options.secrets.hash("owner_session", rawToken), now);
    },

    async startEmailVerification(
      ownerId: string,
      rawInput: unknown,
      now: string,
    ): Promise<StartedEmailVerification> {
      return startEmailVerification(ownerId, rawInput, now, "owner_email_verification");
    },

    async startSearchAlertEmailVerification(
      ownerId: string,
      rawInput: unknown,
      now: string,
      stableContext?: StableSearchAlertVerificationContext,
    ): Promise<PreparedSearchAlertEmailVerification> {
      const input = startEmailVerificationInputSchema.parse(rawInput);
      const protectedEmail = options.email.protect(input.email);
      const existing = (await options.store.listVerificationEndpoints(ownerId)).find(
        (endpoint) =>
          endpoint.kind === "email" && endpoint.addressHash === protectedEmail.addressHash,
      );
      if (existing?.status === "verified") {
        return {
          verificationRequired: false,
          challengeId: stableContext?.challengeId ?? options.ids.challenge(),
          endpointId: existing.id,
          rawCode: null,
          expiresAt: after(now, challengeTtlSeconds),
          maskedAddress: existing.maskedAddress,
          encryptedAddress: null,
        };
      }
      if (existing?.status === "revoked") {
        throw new DomainError({
          code: "CONFLICT",
          message: "This delivery address is revoked and cannot be used for search alerts.",
          details: { reason: "revoked_destination" },
        });
      }
      return {
        ...(await startEmailVerification(
          ownerId,
          input,
          now,
          "search_alert_review",
          stableContext,
        )),
        verificationRequired: true,
      };
    },

    async completeEmailVerification(ownerId: string, rawInput: unknown, now: string) {
      return completeEmailVerification(ownerId, rawInput, now, "owner_email_verification", false);
    },

    async confirmSearchAlertEmailVerification(ownerId: string, rawInput: unknown, now: string) {
      return completeEmailVerification(ownerId, rawInput, now, "search_alert_review", true);
    },

    abandonSearchAlertEmailVerification(ownerId: string, challengeId: string, now: string) {
      return options.store.abandonEmailVerification({
        ownerId,
        challengeId,
        expectedPurpose: "search_alert_review",
        now,
      });
    },

    purgeExpiredSearchAlertEmailVerifications(now: string, limit: number) {
      const boundedLimit = boundedInteger(limit, 1, 1_000, "Verification retention limit");
      return options.store.purgeExpiredEmailVerifications({
        purpose: "search_alert_review",
        now,
        limit: boundedLimit,
      });
    },

    async startOwnerRecovery(rawInput: unknown, now: string) {
      const input = startOwnerRecoveryInputSchema.parse(rawInput);
      const protectedEmail = options.email.protect(input.email);
      const rawCode = options.secrets.createVerificationCode();
      if (!/^\d{6}$/.test(rawCode)) {
        throw new Error("Verification code source must return exactly six digits.");
      }
      const recoveryId = options.ids.recovery();
      const expiresAt = after(now, recoveryChallengeTtlSeconds);
      const stored = await options.store.beginOwnerRecovery({
        addressHash: protectedEmail.addressHash,
        challenge: {
          id: recoveryId,
          tokenHash: options.secrets.hash("owner_recovery", `${recoveryId}\u0000${rawCode}`),
          status: "pending",
          attempts: 0,
          maxAttempts: maxChallengeAttempts,
          expiresAt,
          consumedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      return {
        recoveryId,
        rawCode,
        expiresAt,
        encryptedAddress: stored?.endpoint.addressCiphertext ?? null,
      };
    },

    async completeOwnerRecovery(rawInput: unknown, now: string): Promise<CreatedOwnerSession> {
      const input = completeOwnerRecoveryInputSchema.parse(rawInput);
      const rawToken = options.secrets.createSessionToken();
      if (rawToken.length < 32)
        throw new Error("Session token source returned insufficient entropy.");
      const sessionId = options.ids.session();
      const expiresAt = after(now, sessionTtlSeconds);
      const result = await options.store.consumeOwnerRecovery({
        challengeId: input.recoveryId,
        tokenHash: options.secrets.hash("owner_recovery", `${input.recoveryId}\u0000${input.code}`),
        now,
        session: {
          id: sessionId,
          tokenHash: options.secrets.hash("owner_session", rawToken),
          status: "active",
          expiresAt,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });
      if (result.status !== "recovered") {
        throw new DomainError({
          code: "UNAUTHORIZED",
          message: "Recovery could not be completed. Request a new code.",
        });
      }
      return { owner: result.owner, sessionId, rawToken, expiresAt: result.session.expiresAt };
    },

    async startOwnerDeletion(ownerId: string, rawInput: unknown, now: string) {
      createOwnerDeletionIntentInputSchema.parse(rawInput);
      return options.store.beginOwnerDeletion({
        id: options.ids.deletion(),
        ownerId,
        status: "pending",
        expiresAt: after(now, deletionIntentTtlSeconds),
        createdAt: now,
        updatedAt: now,
      });
    },

    async completeOwnerDeletion(
      ownerId: string,
      sessionId: string,
      rawInput: unknown,
      now: string,
    ) {
      const input = completeOwnerDeletionInputSchema.parse(rawInput);
      const deleted = await options.store.deleteOwnerPrivateData({
        ownerId,
        sessionId,
        deletionId: input.deletionId,
        now,
      });
      if (!deleted) {
        throw new DomainError({
          code: "CONFLICT",
          message: "The deletion request expired or no longer matches this private session.",
        });
      }
      return { deleted: true as const };
    },

    async listVerificationEndpoints(ownerId: string) {
      return options.store.listVerificationEndpoints(ownerId);
    },

    async revokeVerificationEndpoint(ownerId: string, endpointId: string, now: string) {
      const endpoint = await options.store.revokeVerificationEndpoint(ownerId, endpointId, now);
      if (endpoint === null) {
        throw new DomainError({
          code: "NOT_FOUND",
          message: "Verification endpoint was not found.",
        });
      }
      return endpoint;
    },
  };
}
