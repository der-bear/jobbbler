import { describe, expect, it } from "vitest";

import {
  ownerActivityClearResultSchema,
  ownerActivityEventSchema,
  ownerActivityPageSchema,
} from "./activity";

const event = {
  id: "activity_550e8400-e29b-41d4-a716-446655440000",
  schemaVersion: 1 as const,
  kind: "tool" as const,
  key: "edit_application",
  status: "completed" as const,
  safeSummary: "Application draft updated.",
  correlationId: "corr_550e8400-e29b-41d4-a716-446655440000",
  actorKind: "agent" as const,
  aggregate: { type: "application_draft" as const, version: 3 },
  occurredAt: "2026-08-29T10:00:00.000Z",
  effects: [{ target: "application" as const, kind: "refresh" as const }],
};

describe("owner activity contracts", () => {
  it("accepts a bounded clear-history receipt", () => {
    expect(ownerActivityClearResultSchema.parse({ clearedCount: 3 })).toEqual({ clearedCount: 3 });
    expect(ownerActivityClearResultSchema.safeParse({ clearedCount: -1 }).success).toBe(false);
    expect(
      ownerActivityClearResultSchema.safeParse({ clearedCount: 3, ownerId: "private" }).success,
    ).toBe(false);
  });

  it("accepts only the versioned, presentation-safe event envelope", () => {
    expect(ownerActivityEventSchema.parse(event)).toEqual(event);
    expect(ownerActivityEventSchema.safeParse({ ...event, ownerId: "owner_private" }).success).toBe(
      false,
    );
  });

  it.each([
    "Sent details to person@example.com.",
    "Used Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature.",
    "Read https://private.example/application.",
    "Updated draft_550e8400-e29b-41d4-a716-446655440000.",
    "cookie=session-secret-with-at-least-thirty-two-characters",
    "<html>raw source</html>",
  ])("rejects unsafe summaries: %s", (safeSummary) => {
    expect(ownerActivityEventSchema.safeParse({ ...event, safeSummary }).success).toBe(false);
  });

  it("accepts a strict bounded cursor page without owner identifiers", () => {
    const page = {
      events: [event],
      nextCursor: "v1.MQ.signature",
      hasMore: false,
      resyncRequired: false,
      pollAfterMs: 5_000,
    };
    expect(ownerActivityPageSchema.parse(page)).toEqual(page);
    expect(ownerActivityPageSchema.safeParse({ ...page, ownerId: "owner_private" }).success).toBe(
      false,
    );
  });
});
