import { describe, expect, it, vi } from "vitest";

import type { JobAlertSchedule, SavedSearch } from "@jobbbler/contracts";

import { createSavedToolManifests } from "./webmcp-tools";

const savedSearch: SavedSearch = {
  id: "saved_00000001-0000-7000-8000-000000000001",
  ownerId: "owner_00000001-0000-7000-8000-000000000001",
  name: "Senior platform roles",
  criteria: {
    query: "platform",
    categories: ["software_engineering"],
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
  createdAt: "2026-08-29T08:00:00.000Z",
  updatedAt: "2026-08-29T08:00:00.000Z",
};

const schedule: JobAlertSchedule = {
  id: "schedule_00000001-0000-7000-8000-000000000001",
  ownerId: savedSearch.ownerId,
  savedSearchId: savedSearch.id,
  recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
  delivery: {
    channel: "email",
    endpointId: "endpoint_00000001-0000-7000-8000-000000000001",
  },
  enabled: true,
  nextRunAt: "2026-08-30T06:00:00.000Z",
  version: 2,
  createdAt: "2026-08-29T08:00:00.000Z",
  updatedAt: "2026-08-29T08:00:00.000Z",
};

describe("saved-route WebMCP tools", () => {
  it("reads a bounded owner-scoped alert summary without destinations", async () => {
    const manifests = createSavedToolManifests({
      listSavedSearches: vi.fn(async () => [savedSearch]),
      listSchedules: vi.fn(async () => [schedule]),
      setScheduleEnabled: vi.fn(),
      savedSearchHref: () => "/",
      getLatestRun: vi.fn(async () => ({
        savedSearchId: savedSearch.id,
        evaluation: null,
        delivery: null,
      })),
      onNavigate: () => undefined,
      onScheduleCommitted: vi.fn(),
    });

    expect(manifests.map(({ name }) => name)).toEqual([
      "get_saved_alerts",
      "set_job_alert_state",
      "open_saved_search",
      "get_latest_search_update",
    ]);
    expect(manifests.map(({ annotations }) => annotations.readOnlyHint)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    const result = await manifests[0]!.execute({}, { signal: new AbortController().signal });
    expect(result).toMatchObject({
      status: "completed",
      data: {
        alerts: [
          {
            savedSearchId: savedSearch.id,
            scheduleId: schedule.id,
            enabled: true,
            name: savedSearch.name,
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(schedule.delivery.endpointId);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(1_500);
  });

  it("uses the authoritative schedule version and synchronizes the visible workspace", async () => {
    const setScheduleEnabled = vi.fn(async () => ({ ...schedule, enabled: false, version: 3 }));
    const onScheduleCommitted = vi.fn();
    const manifests = createSavedToolManifests({
      listSavedSearches: vi.fn(async () => [savedSearch]),
      listSchedules: vi.fn(async () => [schedule]),
      setScheduleEnabled,
      savedSearchHref: () => "/",
      getLatestRun: vi.fn(async () => ({
        savedSearchId: savedSearch.id,
        evaluation: null,
        delivery: null,
      })),
      onNavigate: () => undefined,
      onScheduleCommitted,
    });
    const signal = new AbortController().signal;
    const result = await manifests[1]!.execute(
      { scheduleId: schedule.id, enabled: false },
      { signal },
    );

    expect(setScheduleEnabled).toHaveBeenCalledWith(
      schedule.id,
      { expectedVersion: schedule.version, enabled: false },
      { signal },
    );
    expect(onScheduleCommitted).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
    expect(result).toMatchObject({ status: "completed", data: { enabled: false, version: 3 } });
  });

  it("rejects unknown schedules and extra input before mutation", async () => {
    const setScheduleEnabled = vi.fn();
    const manifests = createSavedToolManifests({
      listSavedSearches: vi.fn(async () => [savedSearch]),
      listSchedules: vi.fn(async () => [schedule]),
      setScheduleEnabled,
      savedSearchHref: () => "/",
      getLatestRun: vi.fn(async () => ({
        savedSearchId: savedSearch.id,
        evaluation: null,
        delivery: null,
      })),
      onNavigate: () => undefined,
      onScheduleCommitted: vi.fn(),
    });
    const signal = new AbortController().signal;
    const result = await manifests[1]!.execute(
      {
        scheduleId: "schedule_00000002-0000-7000-8000-000000000002",
        enabled: false,
        secret: "no",
      },
      { signal },
    );
    expect(result).toMatchObject({ status: "failed", error: { code: "VALIDATION" } });
    expect(setScheduleEnabled).not.toHaveBeenCalled();
  });
});
