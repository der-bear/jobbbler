import { describe, expect, it, vi } from "vitest";

import type { OwnerActivityEventRecord } from "@jobbbler/storage";

import { createOwnerActivityPublisher } from "./owner-activity-publisher";

describe("committed owner activity publisher", () => {
  it("appends only a strict sanitized projection and preserves command correlation", async () => {
    const append = vi.fn(async ({ ownerId, event }) => ({ sequence: 1, ownerId, event }));
    const publisher = createOwnerActivityPublisher(
      { append },
      { id: () => "activity_550e8400-e29b-41d4-a716-446655440000" },
    );

    await expect(
      publisher.publish({
        ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
        correlationId: "req_550e8400-e29b-41d4-a716-446655440000",
        kind: "application",
        key: "review_application",
        status: "completed",
        safeSummary: "Application review sealed for candidate approval.",
        actorKind: "agent",
        aggregate: { type: "application_draft", version: 4 },
        occurredAt: "2026-08-29T10:00:00.000Z",
        effects: [
          { target: "application", kind: "refresh" },
          { target: "agent_activity", kind: "announce" },
        ],
      }),
    ).resolves.toBe(true);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
        event: expect.objectContaining({
          id: "activity_550e8400-e29b-41d4-a716-446655440000",
          schemaVersion: 1,
          correlationId: "req_550e8400-e29b-41d4-a716-446655440000",
        }),
      }),
    );
  });

  it("fails closed without blocking the already committed command", async () => {
    const append = vi.fn<() => Promise<OwnerActivityEventRecord>>();
    const onFailure = vi.fn();
    const publisher = createOwnerActivityPublisher(
      { append },
      {
        id: () => "activity_550e8400-e29b-41d4-a716-446655440001",
        onFailure,
      },
    );

    await expect(
      publisher.publish({
        ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
        correlationId: "req_550e8400-e29b-41d4-a716-446655440000",
        kind: "consent",
        key: "approve_data_grant",
        status: "completed",
        safeSummary: "token=secret-value",
        actorKind: "human",
        aggregate: { type: "application_draft", version: 2 },
        occurredAt: "2026-08-29T10:00:00.000Z",
        effects: [{ target: "agent_activity", kind: "announce" }],
      }),
    ).resolves.toBe(false);
    expect(append).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith({ errorKind: "ZodError" });
  });
});
