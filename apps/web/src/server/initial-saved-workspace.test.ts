import { describe, expect, it, vi } from "vitest";

import { loadInitialSavedWorkspace } from "./initial-saved-workspace";

const owner = {
  id: "owner_550e8400-e29b-41d4-a716-446655440000",
  kind: "guest" as const,
  verified: true,
  version: 1,
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
};

describe("loadInitialSavedWorkspace", () => {
  it("loads the owner and core alert data for the server render", async () => {
    const listVerificationEndpoints = vi.fn().mockResolvedValue([
      {
        id: "endpoint_550e8400-e29b-41d4-a716-446655440000",
        kind: "email",
        maskedAddress: "a***@example.com",
        status: "verified",
        verifiedAt: "2026-08-30T10:00:00.000Z",
      },
    ]);
    const listSavedSearches = vi.fn().mockResolvedValue([]);
    const listSchedules = vi.fn().mockResolvedValue([]);

    const result = await loadInitialSavedWorkspace({
      request: new Request("https://jobbbler.example/saved"),
      identity: {
        now: () => "2026-08-30T10:00:00.000Z",
        environment: {},
        identity: {
          resolveSession: vi.fn().mockResolvedValue({ owner, session: {} }),
          listVerificationEndpoints,
        },
      } as never,
      savedSearches: {
        service: { listSavedSearches, listSchedules },
      } as never,
    });

    expect(result).toEqual({
      owner: { id: owner.id, kind: "guest", verified: true, recoverable: true },
      endpoints: [
        {
          id: "endpoint_550e8400-e29b-41d4-a716-446655440000",
          kind: "email",
          maskedDestination: "a***@example.com",
          status: "verified",
          verifiedAt: "2026-08-30T10:00:00.000Z",
        },
      ],
      savedSearches: [],
      schedules: [],
    });
    expect(listVerificationEndpoints).toHaveBeenCalledWith(owner.id);
    expect(listSavedSearches).toHaveBeenCalledWith(owner.id);
    expect(listSchedules).toHaveBeenCalledWith(owner.id);
  });

  it("returns an explicit empty private state when no session exists", async () => {
    await expect(
      loadInitialSavedWorkspace({
        request: new Request("https://jobbbler.example/saved"),
        identity: {
          now: () => "2026-08-30T10:00:00.000Z",
          environment: {},
          identity: { resolveSession: vi.fn().mockResolvedValue(null) },
        } as never,
        savedSearches: {} as never,
      }),
    ).resolves.toBeNull();
  });
});
