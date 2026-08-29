import { describe, expect, it } from "vitest";

import type { JobAlertSchedule, SavedSearch } from "@jobbbler/contracts";

import { createSavedSearchService } from "./service.js";
import type { SavedSearchServicePorts } from "./service.js";

const now = "2026-08-29T10:00:00.000Z";
const ownerId = "owner_550e8400-e29b-41d4-a716-446655440000";
const endpointId = "endpoint_550e8400-e29b-41d4-a716-446655440000";
const criteria = {
  query: "TypeScript",
  categories: ["software_engineering" as const],
  workModels: ["remote" as const],
  seniorities: [],
  locations: ["Europe"],
  skills: ["React"],
  excludeKeywords: [],
  salary: null,
  postedWithinDays: 30,
  sort: "newest" as const,
  cursor: "page-cursor",
  limit: 20,
  unresolvedAssumptions: [],
};

function ports() {
  const saved = new Map<string, SavedSearch>();
  const schedules = new Map<string, JobAlertSchedule>();
  const current: SavedSearchServicePorts = {
    savedSearches: {
      insert: async (record) => (saved.set(record.id, record), record),
      getById: async (id) => saved.get(id) ?? null,
      listByOwner: async (id) => [...saved.values()].filter(({ ownerId: owner }) => owner === id),
      delete: async (id) => {
        if (!saved.delete(id)) return false;
        for (const [scheduleId, schedule] of schedules) {
          if (schedule.savedSearchId === id) schedules.delete(scheduleId);
        }
        return true;
      },
    },
    schedules: {
      insert: async (record) => (schedules.set(record.id, record), record),
      getById: async (id) => schedules.get(id) ?? null,
      listByOwner: async (id) =>
        [...schedules.values()].filter(({ ownerId: owner }) => owner === id),
      update: async (record, expectedVersion) => {
        const existing = schedules.get(record.id);
        if (existing?.version !== expectedVersion) throw new Error("version conflict");
        const updated = { ...record, version: expectedVersion + 1 };
        schedules.set(record.id, updated);
        return updated;
      },
    },
    endpoints: {
      getVerificationEndpoint: async (owner, endpoint) =>
        owner === ownerId && endpoint === endpointId
          ? {
              id: endpointId,
              ownerId,
              kind: "email",
              addressHash: "hash",
              addressCiphertext: "sealed",
              maskedAddress: "p•••••@example.com",
              status: "verified",
              verifiedAt: now,
              createdAt: now,
              updatedAt: now,
            }
          : null,
    },
    ids: {
      savedSearch: () => "saved_550e8400-e29b-41d4-a716-446655440000",
      schedule: () => "schedule_550e8400-e29b-41d4-a716-446655440000",
    },
  };
  return { current, saved, schedules };
}

describe("saved-search and alert service", () => {
  it("stores one owner-scoped cursor-free search definition", async () => {
    const state = ports();
    const service = createSavedSearchService(state.current);
    const saved = await service.createSavedSearch(
      ownerId,
      { name: "Remote TypeScript", criteria },
      now,
    );

    expect(saved).toMatchObject({ ownerId, name: "Remote TypeScript", version: 0 });
    expect(saved.criteria.cursor).toBeNull();
    await expect(service.listSavedSearches(ownerId)).resolves.toEqual([saved]);
  });

  it("previews and creates an alert only for an owned search and verified endpoint", async () => {
    const state = ports();
    const service = createSavedSearchService(state.current);
    const saved = await service.createSavedSearch(
      ownerId,
      { name: "Remote TypeScript", criteria },
      now,
    );
    const input = {
      savedSearchId: saved.id,
      expectedVersion: 0,
      recurrence: { frequency: "daily" as const, time: "09:00", timeZone: "Europe/Kyiv" },
      delivery: { channel: "email" as const, endpointId },
    };

    await expect(service.previewSchedule(ownerId, input, now)).resolves.toEqual({
      recurrence: input.recurrence,
      nextRunAt: "2026-08-30T06:01:20.000Z",
      delivery: { channel: "email", endpointId, maskedDestination: "p•••••@example.com" },
    });
    await expect(service.scheduleAlert(ownerId, input, now)).resolves.toMatchObject({
      ownerId,
      savedSearchId: saved.id,
      enabled: true,
      nextRunAt: "2026-08-30T06:01:20.000Z",
    });
  });

  it("returns an existing identical alert and rejects a second schedule with changed settings", async () => {
    const state = ports();
    const service = createSavedSearchService(state.current);
    const saved = await service.createSavedSearch(
      ownerId,
      { name: "Remote TypeScript", criteria },
      now,
    );
    const input = {
      savedSearchId: saved.id,
      expectedVersion: 0,
      recurrence: { frequency: "daily" as const, time: "09:00", timeZone: "Europe/Kyiv" },
      delivery: { channel: "email" as const, endpointId },
    };
    const first = await service.scheduleAlert(ownerId, input, now);
    await expect(service.scheduleAlert(ownerId, input, now)).resolves.toEqual(first);
    expect(state.schedules.size).toBe(1);
    await expect(
      service.scheduleAlert(
        ownerId,
        { ...input, recurrence: { ...input.recurrence, time: "10:00" } },
        now,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("denies a foreign search or unverified destination", async () => {
    const state = ports();
    const service = createSavedSearchService(state.current);
    const saved = await service.createSavedSearch(
      ownerId,
      { name: "Remote TypeScript", criteria },
      now,
    );
    const input = {
      savedSearchId: saved.id,
      expectedVersion: 0,
      recurrence: { frequency: "daily" as const, time: "09:00", timeZone: "UTC" },
      delivery: {
        channel: "email" as const,
        endpointId: "endpoint_650e8400-e29b-41d4-a716-446655440000",
      },
    };

    await expect(service.previewSchedule(ownerId, input, now)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      service.previewSchedule("owner_650e8400-e29b-41d4-a716-446655440000", input, now),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("pauses and resumes with optimistic versioning and a fresh due instant", async () => {
    const state = ports();
    const service = createSavedSearchService(state.current);
    const saved = await service.createSavedSearch(
      ownerId,
      { name: "Remote TypeScript", criteria },
      now,
    );
    const scheduled = await service.scheduleAlert(
      ownerId,
      {
        savedSearchId: saved.id,
        expectedVersion: 0,
        recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
        delivery: { channel: "email", endpointId },
      },
      now,
    );

    const paused = await service.setScheduleEnabled(
      ownerId,
      scheduled.id,
      { expectedVersion: 0, enabled: false },
      now,
    );
    expect(paused).toMatchObject({ enabled: false, version: 1 });
    const resumed = await service.setScheduleEnabled(
      ownerId,
      scheduled.id,
      { expectedVersion: 1, enabled: true },
      "2026-08-30T12:00:00.000Z",
    );
    expect(resumed).toMatchObject({
      enabled: true,
      version: 2,
      nextRunAt: "2026-08-31T09:01:20.000Z",
    });
  });

  it("updates recurrence and delivery with optimistic versioning and a fresh due instant", async () => {
    const state = ports();
    const service = createSavedSearchService(state.current);
    const saved = await service.createSavedSearch(
      ownerId,
      { name: "Remote TypeScript", criteria },
      now,
    );
    const scheduled = await service.scheduleAlert(
      ownerId,
      {
        savedSearchId: saved.id,
        expectedVersion: 0,
        recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
        delivery: { channel: "email", endpointId },
      },
      now,
    );

    const updated = await service.updateSchedule(
      ownerId,
      scheduled.id,
      {
        expectedVersion: 0,
        recurrence: { frequency: "daily", time: "18:00", timeZone: "UTC" },
      },
      now,
    );
    expect(updated).toMatchObject({
      version: 1,
      recurrence: { time: "18:00" },
      delivery: { channel: "email", endpointId },
      nextRunAt: "2026-08-29T18:01:20.000Z",
    });

    await expect(
      service.updateSchedule(
        ownerId,
        scheduled.id,
        { expectedVersion: 0, recurrence: { frequency: "daily", time: "07:00", timeZone: "UTC" } },
        now,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      service.updateSchedule(
        ownerId,
        scheduled.id,
        {
          expectedVersion: 1,
          delivery: {
            channel: "email",
            endpointId: "endpoint_650e8400-e29b-41d4-a716-446655440000",
          },
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.updateSchedule(ownerId, scheduled.id, { expectedVersion: 1 }, now),
    ).rejects.toThrow();
    const delivered = await service.updateSchedule(
      ownerId,
      scheduled.id,
      { expectedVersion: 1, delivery: { channel: "email", endpointId } },
      now,
    );
    expect(delivered).toMatchObject({
      version: 2,
      nextRunAt: updated.nextRunAt,
      delivery: { endpointId },
    });
  });

  it("deletes an owned saved search together with its schedule", async () => {
    const state = ports();
    const service = createSavedSearchService(state.current);
    const saved = await service.createSavedSearch(
      ownerId,
      { name: "Remote TypeScript", criteria },
      now,
    );
    const scheduled = await service.scheduleAlert(
      ownerId,
      {
        savedSearchId: saved.id,
        expectedVersion: 0,
        recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
        delivery: { channel: "email", endpointId },
      },
      now,
    );

    await expect(
      service.deleteSavedSearch("owner_650e8400-e29b-41d4-a716-446655440000", saved.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.deleteSavedSearch(ownerId, saved.id)).resolves.toEqual({
      savedSearch: saved,
      schedule: scheduled,
    });
    expect(state.saved.size).toBe(0);
    expect(state.schedules.size).toBe(0);
    await expect(service.deleteSavedSearch(ownerId, saved.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
