import { describe, expect, it } from "vitest";

import { createIdentityService } from "./service.js";
import type {
  ConsumeVerificationResult,
  IdentityStore,
  OwnerIdentityRecord,
  OwnerSessionRecord,
  VerificationChallengeRecord,
  VerificationEndpointRecord,
} from "./types.js";

const now = "2026-08-29T10:00:00.000Z";
const ids = {
  owner: () => "owner_550e8400-e29b-41d4-a716-446655440000",
  session: () => "session_550e8400-e29b-41d4-a716-446655440001",
  endpoint: () => "endpoint_550e8400-e29b-41d4-a716-446655440002",
  challenge: () => "challenge_550e8400-e29b-41d4-a716-446655440003",
  recovery: () => "recovery_550e8400-e29b-41d4-a716-446655440004",
  deletion: () => "deletion_550e8400-e29b-41d4-a716-446655440005",
};

function fakeStore() {
  let owner: OwnerIdentityRecord | null = null;
  let session: OwnerSessionRecord | null = null;
  let endpoint: VerificationEndpointRecord | null = null;
  let challenge: VerificationChallengeRecord | null = null;
  let consumeResult: ConsumeVerificationResult | null = null;
  const store: IdentityStore = {
    async createOwnerWithSession(input) {
      owner = input.owner;
      session = input.session;
      return input;
    },
    async resolveSession(tokenHash, at) {
      if (
        owner === null ||
        session === null ||
        session.tokenHash !== tokenHash ||
        session.status !== "active" ||
        session.expiresAt <= at
      ) {
        return null;
      }
      return { owner, session };
    },
    async beginEmailVerification(input) {
      endpoint = input.endpoint;
      challenge = input.challenge;
      return input;
    },
    async consumeEmailVerification() {
      if (consumeResult === null) throw new Error("Missing consume result.");
      return consumeResult;
    },
    async getVerificationEndpoint(ownerId, endpointId) {
      return endpoint?.ownerId === ownerId && endpoint.id === endpointId ? endpoint : null;
    },
    async listVerificationEndpoints(ownerId) {
      return endpoint?.ownerId === ownerId ? [endpoint] : [];
    },
    async revokeVerificationEndpoint(ownerId, endpointId, revokedAt) {
      if (endpoint?.ownerId !== ownerId || endpoint.id !== endpointId) return null;
      endpoint = { ...endpoint, status: "revoked", updatedAt: revokedAt };
      return endpoint;
    },
    async beginOwnerRecovery() {
      return null;
    },
    async consumeOwnerRecovery() {
      return { status: "invalid" };
    },
    async beginOwnerDeletion(intent) {
      return intent;
    },
    async deleteOwnerPrivateData() {
      return false;
    },
  };
  return {
    store,
    records: () => ({ owner, session, endpoint, challenge }),
    setConsumeResult: (value: ConsumeVerificationResult) => {
      consumeResult = value;
    },
  };
}

function service(store: IdentityStore) {
  const digest = (purpose: string, value: string) => {
    let state = 2_166_136_261;
    for (const character of `${purpose}\u0000${value}`) {
      state = Math.imul(state ^ character.charCodeAt(0), 16_777_619);
    }
    return `test-digest-${(state >>> 0).toString(16)}`;
  };

  return createIdentityService({
    store,
    ids,
    secrets: {
      createSessionToken: () => "session-secret-with-at-least-thirty-two-characters",
      createVerificationCode: () => "372941",
      hash: digest,
    },
    email: {
      protect: (email) => ({
        normalized: email,
        addressHash: `email-hash:${email}`,
        addressCiphertext: `sealed:${email}`,
        maskedAddress: "p•••••@example.com",
      }),
    },
  });
}

describe("progressive owner identity", () => {
  it("creates an ephemeral owner and stores only the session-token hash", async () => {
    const current = fakeStore();
    const created = await service(current.store).createEphemeralSession(now);

    expect(created.rawToken).toBe("session-secret-with-at-least-thirty-two-characters");
    expect(current.records().session?.tokenHash).toBe("test-digest-e6d868ee");
    expect(JSON.stringify(current.records())).not.toContain(created.rawToken);
    expect(created.owner).toMatchObject({ kind: "ephemeral", verified: false });
  });

  it("resolves only an active, unexpired session", async () => {
    const current = fakeStore();
    const identity = service(current.store);
    const created = await identity.createEphemeralSession(now);

    await expect(identity.resolveSession(created.rawToken, now)).resolves.toMatchObject({
      owner: { id: created.owner.id },
    });
    await expect(
      identity.resolveSession(created.rawToken, "2026-09-30T10:00:00.000Z"),
    ).resolves.toBeNull();
  });

  it("protects the email and binds the code hash to one challenge", async () => {
    const current = fakeStore();
    const started = await service(current.store).startEmailVerification(
      ids.owner(),
      { email: "Person@Example.com" },
      now,
    );

    expect(started).toMatchObject({
      rawCode: "372941",
      maskedAddress: "p•••••@example.com",
    });
    expect(current.records().endpoint).toMatchObject({
      addressHash: "email-hash:person@example.com",
      addressCiphertext: "sealed:person@example.com",
    });
    expect(current.records().challenge?.tokenHash).toBe("test-digest-1bdb8261");
    expect(JSON.stringify(current.records())).not.toContain("Person@Example.com");
  });

  it("upgrades the same owner after an affirmative valid challenge", async () => {
    const current = fakeStore();
    current.setConsumeResult({
      status: "verified",
      owner: {
        id: ids.owner(),
        kind: "guest",
        verified: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      endpoint: {
        id: ids.endpoint(),
        ownerId: ids.owner(),
        kind: "email",
        addressHash: "hash",
        addressCiphertext: "sealed",
        maskedAddress: "p•••••@example.com",
        status: "verified",
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });

    await expect(
      service(current.store).completeEmailVerification(
        ids.owner(),
        { challengeId: ids.challenge(), code: "372941" },
        now,
      ),
    ).resolves.toMatchObject({
      owner: { id: ids.owner(), kind: "guest", verified: true, recoverable: true },
      endpointId: ids.endpoint(),
    });
  });

  it("returns a bounded safe denial for an invalid code", async () => {
    const current = fakeStore();
    current.setConsumeResult({ status: "invalid", remainingAttempts: 2 });

    await expect(
      service(current.store).completeEmailVerification(
        ids.owner(),
        { challengeId: ids.challenge(), code: "000000" },
        now,
      ),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      details: { remainingAttempts: 2 },
    });
  });
});
