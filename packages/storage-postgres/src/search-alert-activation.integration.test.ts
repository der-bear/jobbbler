import { afterEach, describe, expect, it } from "vitest";

import type { IdempotencyRecord, SavedSearchRecord, ScheduleRecord } from "@jobbbler/storage";

import { createPostgresStorage, migratePostgres, resetPostgresSchema } from "./index.js";

const databaseUrl = process.env["POSTGRES_TEST_DATABASE_URL"];
const now = "2026-08-30T09:00:00.000Z";
const later = "2026-08-30T09:05:00.000Z";

describe.skipIf(databaseUrl === undefined)("PostgreSQL search-alert activation atomicity", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function createFixture(suffix: string) {
    const storage = createPostgresStorage(databaseUrl!);
    close = () => storage.close();
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);
    const ownerId = `owner-search-alert-activation-${suffix}`;
    const endpointId = `endpoint-search-alert-activation-${suffix}`;
    const challengeId = `challenge-search-alert-activation-${suffix}`;
    const savedSearch: SavedSearchRecord = {
      id: `search-search-alert-activation-${suffix}`,
      ownerId,
      name: "Concurrent alert activation",
      criteria: {
        query: null,
        categories: [],
        workModels: [],
        seniorities: [],
        locations: [],
        skills: [],
        excludeKeywords: [],
        salary: null,
        postedWithinDays: null,
        sort: "relevance",
        cursor: null,
        limit: 20,
        unresolvedAssumptions: [],
      },
      version: 4,
      createdAt: now,
      updatedAt: now,
    };
    await storage.owners.insert({
      id: ownerId,
      kind: "guest",
      verified: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await storage.savedSearches.insert(savedSearch);
    await storage.identity.beginEmailVerification({
      endpoint: {
        id: endpointId,
        ownerId,
        kind: "email",
        addressHash: `address-hash-${suffix}`,
        addressCiphertext: `encrypted-address-${suffix}`,
        maskedAddress: "a••••@example.com",
        status: "pending",
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      challenge: {
        id: challengeId,
        ownerId,
        endpointId,
        purpose: "search_alert_review",
        tokenHash: `verification-token-hash-${suffix}`,
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        expiresAt: "2026-08-30T09:15:00.000Z",
        consumedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    const verified = await storage.identity.consumeEmailVerification({
      ownerId,
      challengeId,
      tokenHash: `verification-token-hash-${suffix}`,
      now,
      expectedPurpose: "search_alert_review",
      acceptConsumed: true,
    });
    if (verified.status !== "verified") throw new Error("Endpoint fixture was not verified.");

    const schedule: ScheduleRecord = {
      id: `schedule-search-alert-activation-${suffix}`,
      ownerId,
      savedSearchId: savedSearch.id,
      recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
      deliveryChannel: "email",
      deliveryEndpointId: endpointId,
      enabled: true,
      nextRunAt: later,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    const decision: IdempotencyRecord = {
      scope: `search_alert.decision:${ownerId}`,
      key: `request-search-alert-activation-${suffix}`,
      requestHash: "a".repeat(64),
      responseStatus: 201,
      responseBody: {
        version: 1,
        status: "completed",
        receipt: { decision: "approved", scheduleId: schedule.id },
        evidence: { reviewBinding: "b".repeat(64), endpointId, savedSearchId: savedSearch.id },
      },
      createdAt: now,
      expiresAt: "2027-08-30T09:00:00.000Z",
    };
    return {
      storage,
      schedule,
      decision,
      input: {
        schedule,
        expectedSavedSearchVersion: savedSearch.version,
        verifiedEndpointId: endpointId,
        decision,
      },
    };
  }

  it("serializes concurrent exact activation retries to one inserted pair", async () => {
    const fixture = await createFixture("equal");

    const results = await Promise.all([
      fixture.storage.searchAlertActivation.commitApproved(fixture.input),
      fixture.storage.searchAlertActivation.commitApproved(fixture.input),
    ]);

    expect(results.map(({ inserted }) => inserted).sort()).toEqual([false, true]);
    expect(results.map(({ schedule }) => schedule)).toEqual([fixture.schedule, fixture.schedule]);
    expect(results.map(({ decision }) => decision)).toEqual([fixture.decision, fixture.decision]);
  });

  it("allows only one of two concurrent conflicting activation pairs to commit", async () => {
    const fixture = await createFixture("conflict");
    const conflicting = {
      ...fixture.input,
      schedule: {
        ...fixture.schedule,
        nextRunAt: "2026-08-31T09:05:00.000Z",
      },
      decision: {
        ...fixture.decision,
        requestHash: "c".repeat(64),
        responseBody: {
          ...(fixture.decision.responseBody as Record<string, unknown>),
          evidence: { reviewBinding: "d".repeat(64) },
        },
      },
    };

    const results = await Promise.allSettled([
      fixture.storage.searchAlertActivation.commitApproved(fixture.input),
      fixture.storage.searchAlertActivation.commitApproved(conflicting),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(
      results.find((result): result is PromiseRejectedResult => result.status === "rejected")
        ?.reason,
    ).toMatchObject({ code: "CONFLICT" });
    const committedSchedule = await fixture.storage.schedules.getById(fixture.schedule.id);
    const committedDecision = await fixture.storage.idempotency.get(
      fixture.decision.scope,
      fixture.decision.key,
    );
    expect(committedSchedule).not.toBeNull();
    expect(committedDecision).not.toBeNull();
    const fulfilled = results.find(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof fixture.storage.searchAlertActivation.commitApproved>>
      > => result.status === "fulfilled",
    );
    expect(fulfilled?.value.schedule).toEqual(committedSchedule);
    expect(fulfilled?.value.decision).toEqual(committedDecision);
  });
});
