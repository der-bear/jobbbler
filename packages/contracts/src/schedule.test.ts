import { describe, expect, it } from "vitest";

import {
  jobAlertScheduleSchema,
  savedSearchSchema,
  scheduleRecurrenceSchema,
  updateJobAlertScheduleInputSchema,
} from "./schedule.js";

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
    const criteria = {
      query: "TypeScript",
      categories: ["software_engineering"],
      workModels: ["remote"],
      seniorities: [],
      locations: ["Europe"],
      skills: ["React"],
      excludeKeywords: [],
      salary: null,
      postedWithinDays: 30,
      sort: "newest",
      cursor: null,
      limit: 20,
      unresolvedAssumptions: [],
    };
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
