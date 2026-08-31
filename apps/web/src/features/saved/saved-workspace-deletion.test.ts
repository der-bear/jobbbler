import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  JobAlertSchedule,
  SavedSearch,
  SavedSearchDeletionReceipt,
} from "@jobbbler/contracts";

import type { LatestSearchRun } from "@/lib/latest-run";
import { commitWebMcpSavedSearch, commitWebMcpSavedSearchDeletion } from "@/lib/webmcp-ui-bridge";

import {
  subscribeSavedWorkspaceCreation,
  subscribeSavedWorkspaceDeletion,
} from "./saved-workspace";

const now = "2026-08-30T09:00:00.000Z";
const ownerId = "owner_00000001-0000-7000-8000-000000000001";

function savedSearch(id: string, name: string): SavedSearch {
  return {
    id,
    ownerId,
    name,
    criteria: {
      query: name,
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
    createdAt: now,
    updatedAt: now,
  };
}

function schedule(id: string, savedSearchId: string): JobAlertSchedule {
  return {
    id,
    ownerId,
    savedSearchId,
    recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
    delivery: {
      channel: "email",
      endpointId: "endpoint_00000001-0000-7000-8000-000000000001",
    },
    enabled: true,
    nextRunAt: "2026-08-31T06:00:00.000Z",
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Saved workspace WebMCP deletion reconciliation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("removes only the committed saved search, its alert, and its latest run", async () => {
    vi.stubGlobal("window", new EventTarget());
    const deleted = savedSearch(
      "saved_search_00000001-0000-7000-8000-000000000001",
      "Platform roles",
    );
    const survivor = savedSearch(
      "saved_search_00000002-0000-7000-8000-000000000002",
      "Product roles",
    );
    const deletedSchedule = schedule("schedule_00000001-0000-7000-8000-000000000001", deleted.id);
    const survivorSchedule = schedule("schedule_00000002-0000-7000-8000-000000000002", survivor.id);
    const deletedRun: LatestSearchRun = {
      savedSearchId: deleted.id,
      evaluation: null,
      delivery: null,
    };
    const survivorRun: LatestSearchRun = {
      savedSearchId: survivor.id,
      evaluation: null,
      delivery: null,
    };
    const receipt: SavedSearchDeletionReceipt = {
      savedSearchId: deleted.id,
      scheduleId: deletedSchedule.id,
      deleted: true,
    };
    let savedSearches: readonly SavedSearch[] = [deleted, survivor];
    let schedules: readonly JobAlertSchedule[] = [deletedSchedule, survivorSchedule];
    let latestRuns: ReadonlyMap<string, LatestSearchRun> = new Map([
      [deleted.id, deletedRun],
      [survivor.id, survivorRun],
    ]);
    let committed: SavedSearchDeletionReceipt | null = null;
    const unsubscribe = subscribeSavedWorkspaceDeletion({
      setSavedSearches: (update) => {
        savedSearches = update(savedSearches);
      },
      setSchedules: (update) => {
        schedules = update(schedules);
      },
      setLatestRuns: (update) => {
        latestRuns = update(latestRuns);
      },
      onCommitted: (nextReceipt) => {
        committed = nextReceipt;
      },
    });

    commitWebMcpSavedSearchDeletion(receipt);

    expect(savedSearches).toEqual([survivor]);
    expect(schedules).toEqual([survivorSchedule]);
    expect([...latestRuns.entries()]).toEqual([[survivor.id, survivorRun]]);
    expect(committed).toEqual(receipt);
    unsubscribe();
  });
});

describe("Saved workspace WebMCP creation reconciliation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prepends a newly saved search once and reports the committed record", () => {
    vi.stubGlobal("window", new EventTarget());
    const existing = savedSearch(
      "saved_search_00000001-0000-7000-8000-000000000001",
      "Platform roles",
    );
    const created = savedSearch(
      "saved_search_00000002-0000-7000-8000-000000000002",
      "Product roles",
    );
    let savedSearches: readonly SavedSearch[] = [existing];
    let committed: SavedSearch | null = null;
    const unsubscribe = subscribeSavedWorkspaceCreation({
      setSavedSearches: (update) => {
        savedSearches = update(savedSearches);
      },
      onCommitted: (savedSearch) => {
        committed = savedSearch;
      },
    });

    commitWebMcpSavedSearch(created);
    commitWebMcpSavedSearch(created);

    expect(savedSearches).toEqual([created, existing]);
    expect(committed).toEqual(created);
    unsubscribe();
  });
});
