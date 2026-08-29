import { describe, expect, it, vi } from "vitest";

import { createIdentityService } from "./service.js";
import type {
  ConsumeOwnerRecoveryResult,
  IdentityStore,
  OwnerDeletionIntentRecord,
  OwnerIdentityRecord,
  OwnerRecoveryChallengeRecord,
  OwnerSessionRecord,
  VerificationEndpointRecord,
} from "./types.js";

const now = "2026-08-29T10:00:00.000Z";
const owner: OwnerIdentityRecord = {
  id: "owner_550e8400-e29b-41d4-a716-446655440000",
  kind: "guest",
  verified: true,
  version: 2,
  createdAt: now,
  updatedAt: now,
};
const endpoint: VerificationEndpointRecord = {
  id: "endpoint_550e8400-e29b-41d4-a716-446655440001",
  ownerId: owner.id,
  kind: "email",
  addressHash: "email-hash:person@example.com",
  addressCiphertext: "sealed:person@example.com",
  maskedAddress: "p•••••@example.com",
  status: "verified",
  verifiedAt: now,
  createdAt: now,
  updatedAt: now,
};

function testDigest(purpose: string, value: string): string {
  let state = 2_166_136_261;
  for (const character of `${purpose}\u0000${value}`) {
    state = Math.imul(state ^ character.charCodeAt(0), 16_777_619);
  }
  return `opaque-${(state >>> 0).toString(16).padStart(8, "0")}`;
}

function recoveryChallenge(): OwnerRecoveryChallengeRecord {
  return {
    id: "recovery_550e8400-e29b-41d4-a716-446655440002",
    ownerId: owner.id,
    endpointId: endpoint.id,
    tokenHash: "test-digest-recovery",
    status: "pending",
    attempts: 0,
    maxAttempts: 5,
    expiresAt: "2026-08-29T10:10:00.000Z",
    consumedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function recoveredSession(): OwnerSessionRecord {
  return {
    id: "session_550e8400-e29b-41d4-a716-446655440003",
    ownerId: owner.id,
    tokenHash: "test-digest-session",
    status: "active",
    expiresAt: "2026-09-05T10:00:00.000Z",
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function identityStore(options: {
  readonly beginResult?: {
    readonly endpoint: VerificationEndpointRecord;
    readonly challenge: OwnerRecoveryChallengeRecord;
  } | null;
  readonly consumeResult?: ConsumeOwnerRecoveryResult;
}) {
  const beginOwnerRecovery = vi.fn(async () => options.beginResult ?? null);
  const consumeOwnerRecovery = vi.fn(
    async (): Promise<ConsumeOwnerRecoveryResult> => options.consumeResult ?? { status: "invalid" },
  );
  const beginOwnerDeletion = vi.fn(async (intent: OwnerDeletionIntentRecord) => intent);
  const deleteOwnerPrivateData = vi.fn(async () => true);
  const store = {
    createOwnerWithSession: vi.fn(),
    resolveSession: vi.fn(),
    beginEmailVerification: vi.fn(),
    consumeEmailVerification: vi.fn(),
    getVerificationEndpoint: vi.fn(),
    listVerificationEndpoints: vi.fn(),
    revokeVerificationEndpoint: vi.fn(),
    beginOwnerRecovery,
    consumeOwnerRecovery,
    beginOwnerDeletion,
    deleteOwnerPrivateData,
  } satisfies IdentityStore;
  return {
    store,
    beginOwnerRecovery,
    consumeOwnerRecovery,
    beginOwnerDeletion,
    deleteOwnerPrivateData,
  };
}

function service(store: IdentityStore) {
  return createIdentityService({
    store,
    ids: {
      owner: () => owner.id,
      session: () => recoveredSession().id,
      endpoint: () => endpoint.id,
      challenge: () => "challenge_550e8400-e29b-41d4-a716-446655440004",
      recovery: () => recoveryChallenge().id,
      deletion: () => "deletion_550e8400-e29b-41d4-a716-446655440005",
    },
    secrets: {
      createSessionToken: () => "new-session-secret-with-at-least-thirty-two-characters",
      createVerificationCode: () => "372941",
      hash: testDigest,
    },
    email: {
      protect: (email) => ({
        normalized: email.trim().toLowerCase(),
        addressHash: `email-hash:${email.trim().toLowerCase()}`,
        addressCiphertext: `sealed:${email.trim().toLowerCase()}`,
        maskedAddress: "p•••••@example.com",
      }),
    },
  });
}

describe("passwordless owner recovery", () => {
  it("persists only a recovery-specific code hash for a verified endpoint", async () => {
    const current = identityStore({ beginResult: { endpoint, challenge: recoveryChallenge() } });

    const started = await service(current.store).startOwnerRecovery(
      { email: " Person@Example.com " },
      now,
    );

    expect(started).toMatchObject({
      recoveryId: recoveryChallenge().id,
      rawCode: "372941",
      encryptedAddress: endpoint.addressCiphertext,
    });
    expect(current.beginOwnerRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        addressHash: endpoint.addressHash,
        challenge: expect.objectContaining({
          id: recoveryChallenge().id,
          tokenHash: testDigest("owner_recovery", `${recoveryChallenge().id}\u0000372941`),
        }),
      }),
    );
    expect(JSON.stringify(current.beginOwnerRecovery.mock.calls)).not.toContain('"rawCode"');
  });

  it("returns the same recovery envelope when no verified endpoint exists", async () => {
    const current = identityStore({ beginResult: null });

    await expect(
      service(current.store).startOwnerRecovery({ email: "unknown@example.com" }, now),
    ).resolves.toEqual({
      recoveryId: recoveryChallenge().id,
      rawCode: "372941",
      expiresAt: "2026-08-29T10:10:00.000Z",
      encryptedAddress: null,
    });
  });

  it("atomically rotates to one new hashed session after single-use recovery", async () => {
    const current = identityStore({
      consumeResult: { status: "recovered", owner, session: recoveredSession() },
    });

    const recovered = await service(current.store).completeOwnerRecovery(
      { recoveryId: recoveryChallenge().id, code: "372941" },
      now,
    );

    expect(recovered.rawToken).toBe("new-session-secret-with-at-least-thirty-two-characters");
    expect(current.consumeOwnerRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: recoveryChallenge().id,
        tokenHash: testDigest("owner_recovery", `${recoveryChallenge().id}\u0000372941`),
        session: expect.objectContaining({
          tokenHash: testDigest(
            "owner_session",
            "new-session-secret-with-at-least-thirty-two-characters",
          ),
        }),
      }),
    );
    expect(JSON.stringify(current.consumeOwnerRecovery.mock.calls)).not.toContain(
      recovered.rawToken,
    );
  });

  it("uses one enumeration-resistant denial for every failed recovery state", async () => {
    for (const consumeResult of [
      { status: "invalid" as const },
      { status: "expired" as const },
      { status: "locked" as const },
      { status: "consumed" as const },
    ]) {
      const current = identityStore({ consumeResult });
      await expect(
        service(current.store).completeOwnerRecovery(
          { recoveryId: recoveryChallenge().id, code: "000000" },
          now,
        ),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: "Recovery could not be completed. Request a new code.",
      });
    }
  });
});

describe("owner private-data deletion", () => {
  it("creates a short owner-bound deletion intent and completes it through storage", async () => {
    const current = identityStore({});
    const identity = service(current.store);

    const intent = await identity.startOwnerDeletion(
      owner.id,
      { confirmation: "DELETE MY PRIVATE DATA" },
      now,
    );
    expect(intent).toMatchObject({
      id: "deletion_550e8400-e29b-41d4-a716-446655440005",
      ownerId: owner.id,
      status: "pending",
      expiresAt: "2026-08-29T10:05:00.000Z",
    });

    await expect(
      identity.completeOwnerDeletion(
        owner.id,
        recoveredSession().id,
        { deletionId: intent.id, confirmation: "DELETE" },
        now,
      ),
    ).resolves.toEqual({ deleted: true });
    expect(current.deleteOwnerPrivateData).toHaveBeenCalledWith({
      ownerId: owner.id,
      sessionId: recoveredSession().id,
      deletionId: intent.id,
      now,
    });
  });
});
