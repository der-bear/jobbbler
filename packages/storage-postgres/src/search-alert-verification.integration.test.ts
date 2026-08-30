import { afterEach, describe, expect, it } from "vitest";

import type {
  OwnerIdentityRecord,
  OwnerSessionRecord,
  VerificationChallengeRecord,
  VerificationEndpointRecord,
} from "@jobbbler/core-domain";

import { createPostgresStorage, migratePostgres, resetPostgresSchema } from "./index.js";

const databaseUrl = process.env["POSTGRES_TEST_DATABASE_URL"];
const now = "2026-08-29T10:00:00.000Z";
const later = "2026-08-29T10:05:00.000Z";

describe.skipIf(databaseUrl === undefined)("PostgreSQL search-alert verification lifecycle", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("confirms each review challenge without mutating a previously verified shared endpoint", async () => {
    const storage = createPostgresStorage(databaseUrl!);
    close = () => storage.close();
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);
    const owner: OwnerIdentityRecord = {
      id: "owner-postgres-search-alert-review",
      kind: "ephemeral",
      verified: false,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    const session: OwnerSessionRecord = {
      id: "session-postgres-search-alert-review",
      ownerId: owner.id,
      tokenHash: "search-alert-session-hash",
      status: "active",
      expiresAt: "2026-09-05T10:00:00.000Z",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const endpoint: VerificationEndpointRecord = {
      id: "endpoint-postgres-search-alert-review-a",
      ownerId: owner.id,
      kind: "email",
      addressHash: "search-alert-address-hash",
      addressCiphertext: "original-encrypted-envelope",
      maskedAddress: "p•••••@example.com",
      status: "pending",
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const firstChallenge: VerificationChallengeRecord = {
      id: "challenge-postgres-search-alert-review-a",
      ownerId: owner.id,
      endpointId: endpoint.id,
      purpose: "search_alert_review",
      tokenHash: "search-alert-code-hash-a",
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      expiresAt: "2026-08-29T10:10:00.000Z",
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await storage.identity.createOwnerWithSession({ owner, session });
    const first = await storage.identity.beginEmailVerification({
      endpoint,
      challenge: firstChallenge,
    });
    await expect(
      storage.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: first.challenge.id,
        tokenHash: first.challenge.tokenHash,
        now,
        expectedPurpose: "search_alert_review",
        acceptConsumed: true,
      }),
    ).resolves.toMatchObject({ status: "verified", owner: { version: 1 } });
    const verifiedEndpoint = await storage.identity.getVerificationEndpoint(owner.id, endpoint.id);
    const replacementChallenge: VerificationChallengeRecord = {
      ...firstChallenge,
      id: "challenge-postgres-search-alert-review-b",
      endpointId: "endpoint-postgres-search-alert-review-b",
      tokenHash: "search-alert-code-hash-b",
      expiresAt: "2026-08-29T10:15:00.000Z",
      createdAt: later,
      updatedAt: later,
    };

    const replacement = await storage.identity.beginEmailVerification({
      endpoint: {
        ...endpoint,
        id: replacementChallenge.endpointId,
        addressCiphertext: "different-encrypted-envelope",
        createdAt: later,
        updatedAt: later,
      },
      challenge: replacementChallenge,
    });

    expect(replacement.endpoint).toEqual(verifiedEndpoint);
    await expect(
      storage.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: replacement.challenge.id,
        tokenHash: replacement.challenge.tokenHash,
        now: later,
        expectedPurpose: "search_alert_review",
        acceptConsumed: true,
      }),
    ).resolves.toMatchObject({
      status: "verified",
      owner: { version: 1 },
      endpoint: verifiedEndpoint,
    });
    const declined = await storage.identity.beginEmailVerification({
      endpoint: {
        ...endpoint,
        id: "endpoint-postgres-search-alert-review-c",
        createdAt: later,
        updatedAt: later,
      },
      challenge: {
        ...firstChallenge,
        id: "challenge-postgres-search-alert-review-c",
        endpointId: "endpoint-postgres-search-alert-review-c",
        tokenHash: "search-alert-code-hash-c",
        createdAt: later,
        updatedAt: later,
      },
    });
    await expect(
      storage.identity.abandonEmailVerification({
        ownerId: owner.id,
        challengeId: declined.challenge.id,
        expectedPurpose: "search_alert_review",
        now: later,
      }),
    ).resolves.toBe(true);
    await expect(
      storage.identity.getVerificationEndpoint(owner.id, first.endpoint.id),
    ).resolves.toEqual(verifiedEndpoint);
  });

  it("keeps simultaneous search-alert review challenges independently consumable", async () => {
    const storage = createPostgresStorage(databaseUrl!);
    close = () => storage.close();
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);
    const owner: OwnerIdentityRecord = {
      id: "owner-postgres-search-alert-concurrent",
      kind: "ephemeral",
      verified: false,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    await storage.identity.createOwnerWithSession({
      owner,
      session: {
        id: "session-postgres-search-alert-concurrent",
        ownerId: owner.id,
        tokenHash: "search-alert-concurrent-session-hash",
        status: "active",
        expiresAt: "2026-09-05T10:00:00.000Z",
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    const endpoint: VerificationEndpointRecord = {
      id: "endpoint-postgres-search-alert-concurrent-a",
      ownerId: owner.id,
      kind: "email",
      addressHash: "search-alert-concurrent-address-hash",
      addressCiphertext: "search-alert-concurrent-envelope-a",
      maskedAddress: "p•••••@example.com",
      status: "pending",
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const firstChallenge: VerificationChallengeRecord = {
      id: "challenge-postgres-search-alert-concurrent-a",
      ownerId: owner.id,
      endpointId: endpoint.id,
      purpose: "search_alert_review",
      tokenHash: "search-alert-concurrent-code-hash-a",
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      expiresAt: "2026-08-29T10:10:00.000Z",
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const first = await storage.identity.beginEmailVerification({
      endpoint,
      challenge: firstChallenge,
    });
    const second = await storage.identity.beginEmailVerification({
      endpoint: {
        ...endpoint,
        id: "endpoint-postgres-search-alert-concurrent-b",
        addressCiphertext: "search-alert-concurrent-envelope-b",
      },
      challenge: {
        ...firstChallenge,
        id: "challenge-postgres-search-alert-concurrent-b",
        endpointId: "endpoint-postgres-search-alert-concurrent-b",
        tokenHash: "search-alert-concurrent-code-hash-b",
      },
    });

    await expect(
      storage.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: first.challenge.id,
        tokenHash: first.challenge.tokenHash,
        now,
        expectedPurpose: "search_alert_review",
        acceptConsumed: true,
      }),
    ).resolves.toMatchObject({ status: "verified", endpoint: { id: first.endpoint.id } });
    await expect(
      storage.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: second.challenge.id,
        tokenHash: second.challenge.tokenHash,
        now,
        expectedPurpose: "search_alert_review",
        acceptConsumed: true,
      }),
    ).resolves.toMatchObject({
      status: "verified",
      owner: { version: 1 },
      endpoint: { id: first.endpoint.id },
    });
  });

  it("abandons and purges only expired review-scoped provisional verification data", async () => {
    const storage = createPostgresStorage(databaseUrl!);
    close = () => storage.close();
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);
    const owner: OwnerIdentityRecord = {
      id: "owner-postgres-search-alert-retention",
      kind: "ephemeral",
      verified: false,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    await storage.identity.createOwnerWithSession({
      owner,
      session: {
        id: "session-postgres-search-alert-retention",
        ownerId: owner.id,
        tokenHash: "search-alert-retention-session-hash",
        status: "active",
        expiresAt: "2026-09-05T10:00:00.000Z",
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    const alertEndpoint: VerificationEndpointRecord = {
      id: "endpoint-postgres-search-alert-retention",
      ownerId: owner.id,
      kind: "email",
      addressHash: "search-alert-retention-address-hash",
      addressCiphertext: "search-alert-retention-envelope",
      maskedAddress: "a•••••@example.com",
      status: "pending",
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const alertChallenge: VerificationChallengeRecord = {
      id: "challenge-postgres-search-alert-retention",
      ownerId: owner.id,
      endpointId: alertEndpoint.id,
      purpose: "search_alert_review",
      tokenHash: "search-alert-retention-code-hash",
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      expiresAt: "2026-08-29T10:10:00.000Z",
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const unrelatedEndpoint: VerificationEndpointRecord = {
      ...alertEndpoint,
      id: "endpoint-postgres-owner-verification-retention",
      addressHash: "owner-verification-retention-address-hash",
      addressCiphertext: "owner-verification-retention-envelope",
    };
    const unrelatedChallenge: VerificationChallengeRecord = {
      ...alertChallenge,
      id: "challenge-postgres-owner-verification-retention",
      endpointId: unrelatedEndpoint.id,
      purpose: "owner_email_verification",
      tokenHash: "owner-verification-retention-code-hash",
    };
    await storage.identity.beginEmailVerification({
      endpoint: alertEndpoint,
      challenge: alertChallenge,
    });
    await storage.identity.beginEmailVerification({
      endpoint: unrelatedEndpoint,
      challenge: unrelatedChallenge,
    });

    await expect(
      storage.identity.purgeExpiredEmailVerifications({
        purpose: "search_alert_review",
        now: "2026-08-29T10:20:00.000Z",
        limit: 1,
      }),
    ).resolves.toBe(1);
    await expect(
      storage.identity.getVerificationEndpoint(owner.id, alertEndpoint.id),
    ).resolves.toBeNull();
    await expect(
      storage.identity.getVerificationEndpoint(owner.id, unrelatedEndpoint.id),
    ).resolves.toMatchObject({ id: unrelatedEndpoint.id, status: "pending" });

    const secondAlert = await storage.identity.beginEmailVerification({
      endpoint: { ...alertEndpoint, id: "endpoint-postgres-search-alert-abandon" },
      challenge: {
        ...alertChallenge,
        id: "challenge-postgres-search-alert-abandon",
        endpointId: "endpoint-postgres-search-alert-abandon",
      },
    });
    await expect(
      storage.identity.abandonEmailVerification({
        ownerId: owner.id,
        challengeId: secondAlert.challenge.id,
        expectedPurpose: "search_alert_review",
        now,
      }),
    ).resolves.toBe(true);
    await expect(
      storage.identity.getVerificationEndpoint(owner.id, secondAlert.endpoint.id),
    ).resolves.toBeNull();
  });
});
