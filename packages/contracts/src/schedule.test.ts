import { describe, expect, it } from "vitest";

import { scheduleRecurrenceSchema } from "./schedule.js";

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
});
