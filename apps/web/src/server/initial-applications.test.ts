import { describe, expect, it, vi } from "vitest";

import type { ApplicationListItem } from "@jobbbler/contracts";

import { loadInitialApplications } from "./initial-applications";

const items: readonly ApplicationListItem[] = [
  {
    draftId: "application_550e8400-e29b-41d4-a716-446655440000",
    state: "draft",
    updatedAt: "2026-08-30T10:00:00.000Z",
    job: {
      id: "job_550e8400-e29b-41d4-a716-446655440000",
      title: "Senior Product Engineer",
      organizationName: "Northstar Labs",
    },
  },
];

describe("loadInitialApplications", () => {
  it("returns the signed-in owner's applications for the server render", async () => {
    const result = await loadInitialApplications({
      request: new Request("https://jobbbler.example/applications"),
      dependencies: {
        identity: {
          now: () => "2026-08-30T10:00:00.000Z",
          environment: {},
          identity: {
            resolveSession: vi
              .fn()
              .mockResolvedValue({ owner: { id: "owner_550e8400-e29b-41d4-a716-446655440000" } }),
          },
        },
        operations: { list: vi.fn().mockResolvedValue(items) },
      } as never,
    });

    expect(result).toEqual(items);
  });
});
