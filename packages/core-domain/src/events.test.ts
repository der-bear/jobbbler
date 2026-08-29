import { describe, expect, it } from "vitest";

import type { Clock } from "./clock.js";
import { createDomainEvent } from "./events.js";

describe("createDomainEvent", () => {
  it("uses the injected clock and preserves correlation", () => {
    const clock: Clock = { now: () => new Date("2026-08-29T10:15:00.000Z") };
    const event = createDomainEvent(
      {
        id: "event_550e8400-e29b-41d4-a716-446655440000",
        type: "job.saved",
        aggregate: {
          type: "saved_job",
          id: "saved_550e8400-e29b-41d4-a716-446655440000",
          version: 1,
        },
        payload: { jobId: "job_550e8400-e29b-41d4-a716-446655440000" },
        correlationId: "corr_550e8400-e29b-41d4-a716-446655440000",
      },
      clock,
    );

    expect(event.occurredAt).toBe("2026-08-29T10:15:00.000Z");
    expect(event.correlationId).toBe("corr_550e8400-e29b-41d4-a716-446655440000");
  });
});
