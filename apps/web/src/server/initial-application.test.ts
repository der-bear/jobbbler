import { describe, expect, it, vi } from "vitest";

import type { Job } from "@jobbbler/contracts";

import { loadInitialApplication } from "./initial-application";

const job: Job = {
  id: "job_550e8400-e29b-41d4-a716-446655440000",
  organizationId: "org_550e8400-e29b-41d4-a716-446655440000",
  organizationName: "Northstar Labs",
  title: "Senior Product Engineer",
  summary: "Build reliable product workflows.",
  categories: ["software_engineering"],
  workModel: "remote",
  employmentType: "full_time",
  seniority: "senior",
  locations: ["Europe"],
  skills: ["TypeScript"],
  salary: null,
  source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
  applyMode: "internal",
  status: "open",
  publishedAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
};

describe("loadInitialApplication", () => {
  it("returns a signed-in owner's workspace and its already-loaded job for the server render", async () => {
    const workspace = { job } as never;

    const result = await loadInitialApplication(
      "application_550e8400-e29b-41d4-a716-446655440000",
      {
        request: new Request(
          "https://jobbbler.example/apply/application_550e8400-e29b-41d4-a716-446655440000",
        ),
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
          operations: { get: vi.fn().mockResolvedValue(workspace) },
        } as never,
      },
    );

    expect(result).toEqual({ workspace, job });
  });

  it("leaves loading to the client when an older workspace response has no job", async () => {
    const result = await loadInitialApplication(
      "application_550e8400-e29b-41d4-a716-446655440000",
      {
        request: new Request(
          "https://jobbbler.example/apply/application_550e8400-e29b-41d4-a716-446655440000",
        ),
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
          operations: { get: vi.fn().mockResolvedValue({}) },
        } as never,
      },
    );

    expect(result).toBeNull();
  });

  it("returns no initial state when the browser has no private workspace session", async () => {
    const result = await loadInitialApplication(
      "application_550e8400-e29b-41d4-a716-446655440000",
      {
        request: new Request(
          "https://jobbbler.example/apply/application_550e8400-e29b-41d4-a716-446655440000",
        ),
        dependencies: {
          identity: {
            now: () => "2026-08-30T10:00:00.000Z",
            environment: {},
            identity: { resolveSession: vi.fn().mockResolvedValue(null) },
          },
          operations: { get: vi.fn() },
        } as never,
      },
    );

    expect(result).toBeNull();
  });

  it("surfaces application dependency failures instead of retrying them as an empty server render", async () => {
    const failure = new Error("Application storage is unavailable");

    await expect(
      loadInitialApplication("application_550e8400-e29b-41d4-a716-446655440000", {
        request: new Request(
          "https://jobbbler.example/apply/application_550e8400-e29b-41d4-a716-446655440000",
        ),
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
          operations: { get: vi.fn().mockRejectedValue(failure) },
        } as never,
      }),
    ).rejects.toBe(failure);
  });
});
