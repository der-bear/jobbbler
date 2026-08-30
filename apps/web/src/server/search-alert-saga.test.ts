import { describe, expect, it } from "vitest";

import {
  createSearchAlertRequestBinding,
  createSearchAlertReviewBinding,
  searchAlertDecisionEnvelopeSchema,
  searchAlertDecisionIntentSchema,
  searchAlertRequestSagaSchema,
} from "./search-alert-saga";

const environment = {
  NODE_ENV: "test",
  TOKEN_HASH_SECRET: "search-alert-saga-test-secret-at-least-32-characters",
};

const criteria = {
  query: "TypeScript",
  categories: ["software_engineering" as const],
  workModels: ["remote" as const],
  seniorities: ["senior" as const],
  locations: ["Europe"],
  skills: ["React"],
  excludeKeywords: [],
  salary: null,
  postedWithinDays: 30,
  sort: "newest" as const,
  cursor: null,
  limit: 20,
  unresolvedAssumptions: [],
};
const recurrence = {
  frequency: "daily" as const,
  time: "09:00",
  timeZone: "Europe/Kyiv",
};

describe("search alert durable saga primitives", () => {
  it("key-binds canonical non-PII policy to the already keyed address identifier", () => {
    const policy = {
      name: "Remote TypeScript",
      criteria,
      recurrence,
      delivery: { channel: "email" as const },
    };
    const keyedAddressId = "a".repeat(64);

    const first = createSearchAlertRequestBinding(environment, policy, keyedAddressId);
    const replay = createSearchAlertRequestBinding(
      environment,
      structuredClone(policy),
      keyedAddressId,
    );
    const changed = createSearchAlertRequestBinding(
      environment,
      { ...policy, recurrence: { ...recurrence, time: "10:00" } },
      keyedAddressId,
    );

    expect(first).toHaveLength(64);
    expect(replay).toBe(first);
    expect(changed).not.toBe(first);
    expect(first).not.toContain("person@example.com");
  });

  it("parses stable pre-side-effect resource identifiers without secret material", () => {
    const saga = searchAlertRequestSagaSchema.parse({
      version: 1,
      status: "preparing",
      ownerId: "owner_550e8400-e29b-41d4-a716-446655440009",
      requestId: "req_550e8400-e29b-41d4-a716-446655440000",
      savedSearchId: "saved_550e8400-e29b-41d4-a716-446655440001",
      endpointId: "endpoint_550e8400-e29b-41d4-a716-446655440002",
      challengeId: "challenge_550e8400-e29b-41d4-a716-446655440003",
      scheduleId: "schedule_550e8400-e29b-41d4-a716-446655440004",
      issuedAt: "2026-08-30T09:00:00.000Z",
    });

    expect(saga.ownerId).toBe("owner_550e8400-e29b-41d4-a716-446655440009");
    expect(JSON.stringify(saga)).not.toMatch(/email|code|token|cipher/iu);
  });

  it("retains review-bound consent evidence without token, challenge, code, or email", () => {
    const envelope = searchAlertDecisionEnvelopeSchema.parse({
      version: 1,
      status: "completed",
      receipt: {
        status: "completed",
        requestId: "req_550e8400-e29b-41d4-a716-446655440000",
        decision: "approved",
        channel: "agent_client",
        savedSearchId: "saved_550e8400-e29b-41d4-a716-446655440001",
        scheduleId: "schedule_550e8400-e29b-41d4-a716-446655440004",
        nextRunAt: "2026-08-31T06:00:48.000Z",
        decidedAt: "2026-08-30T09:05:00.000Z",
        summary: "Job alert activated for the reviewed search and destination.",
      },
      evidence: {
        reviewBinding: "b".repeat(64),
        purpose: "Store this search and email matching-job updates.",
        dataCategories: ["saved_search_criteria", "delivery_email"],
        retention: "Stored until the alert or delivery destination is removed.",
        withdrawal: "Pause or delete the alert, or revoke its delivery destination, at any time.",
        criteria,
        savedSearchId: "saved_550e8400-e29b-41d4-a716-446655440001",
        savedSearchVersion: 0,
        endpointId: "endpoint_550e8400-e29b-41d4-a716-446655440002",
        recurrence,
        firstRunAt: "2026-08-31T06:00:48.000Z",
        privacyNoticeVersion: "search-alert-v1",
        channel: "agent_client",
        decidedAt: "2026-08-30T09:05:00.000Z",
      },
    });

    const serialized = JSON.stringify(envelope);
    expect(serialized).toContain("saved_search_criteria");
    expect(serialized).toContain("withdrawal");
    expect(serialized).not.toMatch(/reviewToken|challengeId|"code"|@example\.com/iu);
  });

  it("binds a durable decision intent to one exact review and decision", () => {
    expect(
      searchAlertDecisionIntentSchema.parse({
        version: 1,
        status: "deciding",
        requestId: "req_550e8400-e29b-41d4-a716-446655440000",
        reviewBinding: "c".repeat(64),
        decision: "approved",
        recordedAt: "2026-08-30T09:05:00.000Z",
      }),
    ).toMatchObject({ decision: "approved", reviewBinding: "c".repeat(64) });
  });

  it("key-binds the authenticated review to the exact durable decision", () => {
    const review = {
      version: 1 as const,
      purpose: "search_alert_activation" as const,
      ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
      requestId: "req_550e8400-e29b-41d4-a716-446655440000",
      savedSearchId: "saved_550e8400-e29b-41d4-a716-446655440001",
      savedSearchVersion: 0,
      endpointId: "endpoint_550e8400-e29b-41d4-a716-446655440002",
      challengeId: "challenge_550e8400-e29b-41d4-a716-446655440003",
      scheduleId: "schedule_550e8400-e29b-41d4-a716-446655440004",
      recurrence,
      firstRunAt: "2026-08-31T06:00:48.000Z",
      privacyNoticeVersion: "search-alert-v1",
      issuedAt: "2026-08-30T09:00:00.000Z",
      expiresAt: "2026-08-30T09:10:00.000Z",
    };

    const approved = createSearchAlertReviewBinding(environment, review, "approved");

    expect(approved).toHaveLength(64);
    expect(createSearchAlertReviewBinding(environment, structuredClone(review), "approved")).toBe(
      approved,
    );
    expect(createSearchAlertReviewBinding(environment, review, "declined")).not.toBe(approved);
  });
});
