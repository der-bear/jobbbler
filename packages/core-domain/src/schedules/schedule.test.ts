import { describe, expect, it } from "vitest";

import {
  calculateNextRun,
  deriveEvaluationJitterSeconds,
  pauseSchedule,
  resumeSchedule,
  type ScheduleState,
} from "./schedule.js";

describe("schedule calendar", () => {
  it("moves a nonexistent daily wall time to the next valid instant during spring DST", () => {
    expect(
      calculateNextRun(
        { frequency: "daily", time: "02:30", timeZone: "America/New_York" },
        "2026-03-08T06:00:00.000Z",
      ),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  it("runs a repeated daily wall time once at its first occurrence during fall DST", () => {
    expect(
      calculateNextRun(
        { frequency: "daily", time: "01:30", timeZone: "America/New_York" },
        "2026-11-01T04:00:00.000Z",
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  it("selects the next requested local weekday", () => {
    expect(
      calculateNextRun(
        {
          frequency: "weekly",
          time: "09:00",
          timeZone: "Europe/Kyiv",
          days: ["monday", "wednesday"],
        },
        "2026-08-31T07:30:00.000Z",
      ),
    ).toBe("2026-09-02T06:00:00.000Z");
  });

  it("uses a stable bounded jitter for one evaluation identity", () => {
    const first = deriveEvaluationJitterSeconds(
      "schedule_550e8400-e29b-41d4-a716-446655440000",
      300,
    );
    expect(first).toBe(140);
    expect(
      deriveEvaluationJitterSeconds("schedule_550e8400-e29b-41d4-a716-446655440000", 300),
    ).toBe(first);
    expect(deriveEvaluationJitterSeconds("another-schedule", 300)).toBeGreaterThanOrEqual(0);
    expect(deriveEvaluationJitterSeconds("another-schedule", 300)).toBeLessThanOrEqual(300);
  });

  it("clears a paused due instant and calculates a fresh future one when resumed", () => {
    const active: ScheduleState = {
      status: "active",
      nextRunAt: "2026-08-29T09:00:00.000Z",
      version: 4,
    };

    const paused = pauseSchedule(active);
    expect(paused).toEqual({ status: "paused", nextRunAt: null, version: 5 });
    expect(
      resumeSchedule(
        paused,
        { frequency: "daily", time: "09:00", timeZone: "UTC" },
        "2026-08-29T10:00:00.000Z",
      ),
    ).toEqual({ status: "active", nextRunAt: "2026-08-30T09:00:00.000Z", version: 6 });
  });
});
