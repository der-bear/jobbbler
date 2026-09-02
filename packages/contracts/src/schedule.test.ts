import { describe, expect, it } from "vitest";

import {
  decideSearchAlertInputSchema,
  decideSearchAlertResultSchema,
  jobAlertScheduleSchema,
  requestSearchAlertInputSchema,
  requestSearchAlertResultSchema,
  savedSearchSchema,
  scheduleRecurrenceSchema,
  updateJobAlertScheduleInputSchema,
} from "./schedule.js";

const criteria = {
  query: "TypeScript",
  categories: ["software_engineering"],
  workModels: ["remote"],
  seniorities: ["senior"],
  locations: ["Europe"],
  skills: ["React"],
  excludeKeywords: [],
  salary: null,
  postedWithinDays: 30,
  sort: "newest",
  cursor: null,
  limit: 20,
  unresolvedAssumptions: [],
} as const;

describe("scheduleRecurrenceSchema", () => {
  it("accepts an explicit IANA weekly schedule", () => {
    const recurrence = scheduleRecurrenceSchema.parse({
      frequency: "weekly",
      time: "08:30",
      timeZone: "Europe/Kyiv",
      days: ["monday", "thursday"],
    });

    expect(recurrence).toMatchObject({ frequency: "weekly", timeZone: "Europe/Kyiv" });
  });

  it("rejects ambiguous time zones and empty weekly days", () => {
    expect(() =>
      scheduleRecurrenceSchema.parse({
        frequency: "daily",
        time: "8:30",
        timeZone: "Kyiv time",
      }),
    ).toThrow();

    expect(() =>
      scheduleRecurrenceSchema.parse({
        frequency: "weekly",
        time: "08:30",
        timeZone: "Europe/Kyiv",
        days: [],
      }),
    ).toThrow();
  });

  it("rejects duplicate weekly days", () => {
    expect(() =>
      scheduleRecurrenceSchema.parse({
        frequency: "weekly",
        time: "08:30",
        timeZone: "Europe/Kyiv",
        days: ["monday", "monday"],
      }),
    ).toThrow(/unique/i);
  });

  it("keeps saved-search and alert records portable across storage adapters", () => {
    const timestamp = "2026-08-29T10:00:00.000Z";
    expect(
      savedSearchSchema.parse({
        id: "saved_550e8400-e29b-41d4-a716-446655440000",
        ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
        name: "Remote TypeScript",
        criteria,
        version: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toMatchObject({ name: "Remote TypeScript", criteria: { cursor: null } });
    expect(
      jobAlertScheduleSchema.parse({
        id: "schedule_550e8400-e29b-41d4-a716-446655440000",
        ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
        savedSearchId: "saved_550e8400-e29b-41d4-a716-446655440000",
        recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
        delivery: {
          channel: "email",
          endpointId: "endpoint_550e8400-e29b-41d4-a716-446655440000",
        },
        enabled: true,
        nextRunAt: "2026-08-30T06:00:00.000Z",
        version: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toMatchObject({ enabled: true, delivery: { channel: "email" } });
  });

  it("requires at least one recurrence or delivery change to update an alert", () => {
    expect(
      updateJobAlertScheduleInputSchema.parse({
        expectedVersion: 2,
        recurrence: { frequency: "daily", time: "07:15", timeZone: "Europe/Kyiv" },
      }),
    ).toMatchObject({ expectedVersion: 2, recurrence: { time: "07:15" } });
    expect(
      updateJobAlertScheduleInputSchema.parse({
        expectedVersion: 0,
        delivery: {
          channel: "email",
          endpointId: "endpoint_550e8400-e29b-41d4-a716-446655440000",
        },
      }),
    ).toMatchObject({ delivery: { channel: "email" } });

    expect(() => updateJobAlertScheduleInputSchema.parse({ expectedVersion: 2 })).toThrow(
      /recurrence or delivery/i,
    );
    expect(() =>
      updateJobAlertScheduleInputSchema.parse({
        expectedVersion: 2,
        enabled: false,
      }),
    ).toThrow();
  });
});

describe("agent-native search alert contracts", () => {
  const requestInput = {
    name: "Remote TypeScript",
    criteria,
    recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
    delivery: { channel: "email", email: " Person@Example.COM " },
  } as const;

  it("accepts only an exact, bounded alert request and normalizes its email", () => {
    expect(requestSearchAlertInputSchema.parse(requestInput)).toMatchObject({
      name: "Remote TypeScript",
      criteria: { query: "TypeScript", limit: 20 },
      delivery: { channel: "email", email: "person@example.com" },
    });

    expect(() =>
      requestSearchAlertInputSchema.parse({ ...requestInput, unexpected: true }),
    ).toThrow();
    expect(() =>
      requestSearchAlertInputSchema.parse({
        ...requestInput,
        criteria: { ...criteria, query: "x".repeat(501) },
      }),
    ).toThrow();
    expect(() =>
      requestSearchAlertInputSchema.parse({
        ...requestInput,
        delivery: { channel: "email", email: "not-an-email" },
      }),
    ).toThrow();
  });

  it("accepts a six-digit code only when an approved review requires mailbox verification", () => {
    const approval = {
      requestId: "req_550e8400-e29b-41d4-a716-446655440000",
      reviewToken: "signed.review",
      code: "042197",
      decision: "approved",
      channel: "agent_client",
    } as const;
    const decline = {
      requestId: approval.requestId,
      reviewToken: approval.reviewToken,
      decision: "declined",
      channel: "agent_client",
    } as const;

    expect(decideSearchAlertInputSchema.parse(approval)).toEqual(approval);
    expect(decideSearchAlertInputSchema.parse({ ...approval, code: undefined })).toEqual({
      requestId: approval.requestId,
      reviewToken: approval.reviewToken,
      decision: "approved",
      channel: "agent_client",
      code: undefined,
    });
    expect(decideSearchAlertInputSchema.parse(decline)).toEqual(decline);
    expect(() => decideSearchAlertInputSchema.parse({ ...decline, code: approval.code })).toThrow();
    expect(() => decideSearchAlertInputSchema.parse({ ...approval, code: "42197" })).toThrow();
    expect(() => decideSearchAlertInputSchema.parse({ ...approval, decision: "yes" })).toThrow();
    expect(() =>
      decideSearchAlertInputSchema.parse({ ...approval, channel: "first_party_ui" }),
    ).toThrow();
    expect(() => decideSearchAlertInputSchema.parse({ ...approval, approved: true })).toThrow();
  });

  it("bounds the external-client review and approval receipt", () => {
    const requestResult = {
      status: "requires_user_action",
      requestId: "req_550e8400-e29b-41d4-a716-446655440000",
      reviewToken: "signed.review",
      expiresAt: "2026-08-30T09:15:00.000Z",
      review: {
        savedSearchId: "saved_550e8400-e29b-41d4-a716-446655440001",
        savedSearchVersion: 0,
        maskedDestination: "p•••••@example.com",
        deliveryVerification: { required: true, method: "email_code" },
        criteria,
        recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
        firstRunAt: "2026-08-31T06:00:48.000Z",
        purpose: "Store this search and email matching-job updates.",
        dataCategories: ["saved_search_criteria", "delivery_email"],
        retention: "Used only while this search alert is on and your email is attached.",
        withdrawal: "Stop it any time: pause or delete the alert, or remove your email.",
        privacyNoticeVersion: "search-alert-v2",
      },
    } as const;
    expect(requestSearchAlertResultSchema.parse(requestResult)).toEqual(requestResult);
    expect(() =>
      requestSearchAlertResultSchema.parse({
        ...requestResult,
        reviewToken: "x".repeat(4_097),
      }),
    ).toThrow();
    expect(() =>
      requestSearchAlertResultSchema.parse({
        ...requestResult,
        review: { ...requestResult.review, purpose: "x".repeat(241) },
      }),
    ).toThrow();

    const approval = {
      status: "completed",
      requestId: requestResult.requestId,
      decision: "approved",
      channel: "agent_client",
      savedSearchId: requestResult.review.savedSearchId,
      scheduleId: "schedule_550e8400-e29b-41d4-a716-446655440002",
      nextRunAt: requestResult.review.firstRunAt,
      decidedAt: "2026-08-30T09:02:00.000Z",
      summary: "Job alert activated for the reviewed search and destination.",
    } as const;
    expect(decideSearchAlertResultSchema.parse(approval)).toEqual(approval);
    expect(
      decideSearchAlertResultSchema.parse({
        ...approval,
        decision: "declined",
        scheduleId: null,
        nextRunAt: null,
        summary: "Job alert activation declined. No schedule was created.",
      }),
    ).toMatchObject({ decision: "declined", scheduleId: null });
    expect(() =>
      decideSearchAlertResultSchema.parse({ ...approval, summary: "x".repeat(241) }),
    ).toThrow();
  });
});
