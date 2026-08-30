import { describe, expect, it, vi } from "vitest";

import type {
  JobAlertSchedule,
  OwnerSessionResult,
  SavedSearch,
  VerificationEndpointSummary,
} from "@jobbbler/contracts";

import type { LatestSearchRun } from "@/lib/latest-run";
import type { QueryApiOptions } from "@/lib/query-client";

import { loadPrivateWorkspaceResources, loadSavedWorkspaceData } from "./saved-workspace-loader";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const session = {
  owner: {
    id: "owner_00000001-0000-7000-8000-000000000001",
    kind: "guest",
    verified: false,
  },
  expiresAt: "2026-08-30T09:00:00.000Z",
} as OwnerSessionResult;
const endpoints: readonly VerificationEndpointSummary[] = [];
const savedSearches: readonly SavedSearch[] = [
  {
    id: "saved_search_00000001-0000-7000-8000-000000000001",
    ownerId: session.owner.id,
    name: "Platform roles",
    criteria: {
      query: "platform",
      categories: [],
      workModels: ["remote"],
      seniorities: ["senior"],
      locations: ["Europe"],
      skills: [],
      excludeKeywords: [],
      salary: null,
      postedWithinDays: null,
      sort: "relevance",
      cursor: null,
      limit: 20,
      unresolvedAssumptions: [],
    },
    version: 0,
    createdAt: "2026-08-30T09:00:00.000Z",
    updatedAt: "2026-08-30T09:00:00.000Z",
  },
];
const schedules: readonly JobAlertSchedule[] = [
  {
    id: "schedule_00000001-0000-7000-8000-000000000001",
    ownerId: session.owner.id,
    savedSearchId: savedSearches[0]!.id,
    recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
    delivery: { channel: "email", endpointId: "endpoint_00000001-0000-7000-8000-000000000001" },
    enabled: true,
    nextRunAt: "2026-08-30T10:00:00.000Z",
    version: 0,
    createdAt: "2026-08-30T09:00:00.000Z",
    updatedAt: "2026-08-30T09:00:00.000Z",
  },
];
const latestRun = {
  savedSearchId: "saved_search_00000001-0000-7000-8000-000000000001",
  evaluation: null,
  delivery: null,
} as LatestSearchRun;

describe("loadSavedWorkspaceData", () => {
  it("starts the owner session and all independent private resources together", async () => {
    const requests = new Map<string, ReturnType<typeof deferred<unknown>>>();
    const request = vi.fn((url: string, _schema: unknown, _options?: QueryApiOptions) => {
      const pending = deferred<unknown>();
      requests.set(url, pending);
      return pending.promise;
    });

    const loading = loadSavedWorkspaceData(request as never);

    expect([...requests.keys()]).toEqual([
      "/api/v1/owners/session",
      "/api/v1/owners/email",
      "/api/v1/saved-searches",
      "/api/v1/schedules",
    ]);

    requests.get("/api/v1/owners/session")!.resolve(session);
    requests.get("/api/v1/owners/email")!.resolve(endpoints);
    requests.get("/api/v1/saved-searches")!.resolve(savedSearches);
    requests.get("/api/v1/schedules")!.resolve(schedules);
    const loaded = await loading;

    expect(loaded.owner).toBe(session.owner);
    expect(request).toHaveBeenCalledTimes(5);
  });

  it("returns core saved content before latest-run hydration completes", async () => {
    const latest = deferred<LatestSearchRun>();
    const request = vi.fn((url: string) => {
      switch (url) {
        case "/api/v1/owners/session":
          return Promise.resolve(session);
        case "/api/v1/owners/email":
          return Promise.resolve(endpoints);
        case "/api/v1/saved-searches":
          return Promise.resolve(savedSearches);
        case "/api/v1/schedules":
          return Promise.resolve(schedules);
        case "/api/v1/saved-searches/saved_search_00000001-0000-7000-8000-000000000001/latest-run":
          return latest.promise;
        default:
          throw new Error(`Unexpected request: ${url}`);
      }
    });

    const loaded = await loadSavedWorkspaceData(request as never);

    expect(loaded.savedSearches).toEqual(savedSearches);
    expect(loaded.latestRuns).toBeInstanceOf(Promise);
    expect(request).toHaveBeenCalledTimes(5);

    latest.resolve(latestRun);
    await expect(loaded.latestRuns).resolves.toEqual(
      new Map([["saved_search_00000001-0000-7000-8000-000000000001", latestRun]]),
    );
  });

  it("does not request latest runs for saved searches without a schedule", async () => {
    const request = vi.fn((url: string) => {
      switch (url) {
        case "/api/v1/owners/email":
          return Promise.resolve(endpoints);
        case "/api/v1/saved-searches":
          return Promise.resolve(savedSearches);
        case "/api/v1/schedules":
          return Promise.resolve([]);
        default:
          throw new Error(`Unexpected request: ${url}`);
      }
    });

    const loaded = await loadPrivateWorkspaceResources(request as never);

    await expect(loaded.latestRuns).resolves.toEqual(new Map());
    expect(request).toHaveBeenCalledTimes(3);
  });
});
