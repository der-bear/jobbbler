import { describe, expect, it, vi } from "vitest";

import { DomainError } from "@jobbbler/core-domain";
import type { IdempotencyRecord } from "@jobbbler/storage";

import type { IdentityRouteDependencies } from "./identity-route-handlers";
import {
  handleAgentDeleteSavedSearchRequest,
  handleAgentSetScheduleEnabledRequest,
  handleCreateSavedSearchRequest,
  handleCreateScheduleRequest,
  handleDeleteSavedSearchRequest,
  handleGetLatestSavedSearchRunRequest,
  handleListSavedSearchesRequest,
  handleListSchedulesRequest,
  handlePreviewScheduleRequest,
  handleSetScheduleEnabledRequest,
  handleUpdateScheduleRequest,
  type SavedSearchRouteDependencies,
} from "./saved-search-route-handlers";

const now = "2026-08-29T10:00:00.000Z";
const owner = {
  id: "owner_550e8400-e29b-41d4-a716-446655440000",
  kind: "guest" as const,
  verified: true,
  version: 1,
  createdAt: now,
  updatedAt: now,
};
const session = {
  id: "session_550e8400-e29b-41d4-a716-446655440001",
  ownerId: owner.id,
  tokenHash: "hash",
  status: "active" as const,
  expiresAt: "2026-09-05T10:00:00.000Z",
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
};
const cookie = "jobbbler_owner=session-secret-with-at-least-thirty-two-characters";
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
  cursor: null,
  limit: 20,
  unresolvedAssumptions: [],
};
const saved = {
  id: "saved_550e8400-e29b-41d4-a716-446655440000",
  ownerId: owner.id,
  name: "Remote TypeScript",
  criteria,
  version: 0,
  createdAt: now,
  updatedAt: now,
};
const schedule = {
  id: "schedule_550e8400-e29b-41d4-a716-446655440000",
  ownerId: owner.id,
  savedSearchId: saved.id,
  recurrence: { frequency: "daily" as const, time: "09:00", timeZone: "Europe/Kyiv" },
  delivery: {
    channel: "email" as const,
    endpointId: "endpoint_550e8400-e29b-41d4-a716-446655440000",
  },
  enabled: true,
  nextRunAt: "2026-08-30T06:01:20.000Z",
  version: 0,
  createdAt: now,
  updatedAt: now,
};

function identity(): IdentityRouteDependencies {
  return {
    identity: {
      createEphemeralSession: vi.fn(),
      resolveSession: vi.fn(async () => ({ owner, session })),
      startEmailVerification: vi.fn(),
      completeEmailVerification: vi.fn(),
      listVerificationEndpoints: vi.fn(async () => []),
      revokeVerificationEndpoint: vi.fn(),
      startOwnerRecovery: vi.fn(),
      completeOwnerRecovery: vi.fn(),
      startOwnerDeletion: vi.fn(),
      completeOwnerDeletion: vi.fn(),
    },
    delivery: { deliverVerification: vi.fn() },
    environment: {
      NODE_ENV: "development",
      PUBLIC_BASE_URL: "https://jobbbler.example",
    },
    now: () => now,
    nowMs: () => Date.parse(now),
    rateLimiter: {
      check: vi.fn(async () => ({
        allowed: true,
        remaining: 4,
        retryAfterSeconds: 0,
        resetAtMs: Date.parse(now) + 60_000,
      })),
    },
    activity: { append: vi.fn() },
  };
}

function idempotencyStore() {
  const records = new Map<string, IdempotencyRecord>();
  return {
    get: vi.fn(async (scope: string, key: string) => records.get(`${scope}:${key}`) ?? null),
    putIfAbsent: vi.fn(async (record: IdempotencyRecord) => {
      const existing = records.get(`${record.scope}:${record.key}`);
      if (existing !== undefined) return { inserted: false, record: existing };
      records.set(`${record.scope}:${record.key}`, record);
      return { inserted: true, record };
    }),
  };
}

function dependencies(): SavedSearchRouteDependencies {
  return {
    identity: identity(),
    activity: { publish: vi.fn(async () => true) },
    idempotency: idempotencyStore(),
    service: {
      ensureSavedSearch: vi.fn(async () => saved),
      createSavedSearch: vi.fn(async () => saved),
      listSavedSearches: vi.fn(async () => [saved]),
      previewSchedule: vi.fn(async () => ({
        recurrence: schedule.recurrence,
        nextRunAt: schedule.nextRunAt,
        delivery: {
          ...schedule.delivery,
          maskedDestination: "p•••••@example.com",
        },
      })),
      scheduleAlert: vi.fn(async () => schedule),
      listSchedules: vi.fn(async () => [schedule]),
      setScheduleEnabled: vi.fn(async () => ({ ...schedule, enabled: false, version: 1 })),
      updateSchedule: vi.fn(async () => ({
        ...schedule,
        recurrence: { frequency: "daily" as const, time: "18:00", timeZone: "Europe/Kyiv" },
        version: 1,
      })),
      deleteSavedSearch: vi.fn(async () => ({ savedSearch: saved, schedule })),
    },
  };
}

function request(
  path: string,
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  return new Request(`https://jobbbler.example${path}`, {
    method,
    headers: {
      cookie,
      ...(method === "GET"
        ? {}
        : {
            origin: "https://jobbbler.example",
            "sec-fetch-site": "same-origin",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("saved-search and schedule route handlers", () => {
  it("creates and lists only within the resolved owner session", async () => {
    const current = dependencies();
    const create = await handleCreateSavedSearchRequest(
      request("/api/v1/saved-searches", "POST", { name: "Remote TypeScript", criteria: {} }),
      current,
    );
    const list = await handleListSavedSearchesRequest(
      request("/api/v1/saved-searches", "GET"),
      current,
    );

    expect(create.status).toBe(201);
    expect(current.service.createSavedSearch).toHaveBeenCalledWith(
      owner.id,
      expect.objectContaining({ name: "Remote TypeScript" }),
      now,
    );
    expect(list.status).toBe(200);
    expect(current.service.listSavedSearches).toHaveBeenCalledWith(owner.id);
  });

  it("previews before activation and keeps preview side-effect free", async () => {
    const current = dependencies();
    const response = await handlePreviewScheduleRequest(
      request("/api/v1/schedules/preview", "POST", { savedSearchId: "saved_1" }),
      current,
    );

    expect(response.status).toBe(200);
    expect(current.service.previewSchedule).toHaveBeenCalledWith(owner.id, expect.any(Object), now);
    expect(current.service.scheduleAlert).not.toHaveBeenCalled();
  });

  it("activates, lists, and pauses one owner-scoped alert", async () => {
    const current = dependencies();
    const created = await handleCreateScheduleRequest(
      request("/api/v1/schedules", "POST", { savedSearchId: "saved_1" }),
      current,
    );
    const listed = await handleListSchedulesRequest(request("/api/v1/schedules", "GET"), current);
    const paused = await handleSetScheduleEnabledRequest(
      request("/api/v1/schedules/schedule_1", "PATCH", {
        expectedVersion: 0,
        enabled: false,
      }),
      { params: Promise.resolve({ scheduleId: "schedule_1" }) },
      current,
    );

    expect(created.status).toBe(201);
    expect(listed.status).toBe(200);
    expect(paused.status).toBe(200);
    expect(current.service.setScheduleEnabled).toHaveBeenCalledWith(
      owner.id,
      "schedule_1",
      { expectedVersion: 0, enabled: false },
      now,
    );
  });

  it("attributes the dedicated WebMCP schedule mutation to the agent channel", async () => {
    const human = dependencies();
    await handleSetScheduleEnabledRequest(
      request("/api/v1/schedules/schedule_1", "PATCH", {
        expectedVersion: 0,
        enabled: false,
      }),
      { params: Promise.resolve({ scheduleId: "schedule_1" }) },
      human,
    );

    expect(human.activity?.publish).toHaveBeenCalledWith(
      expect.objectContaining({ key: "set_job_alert_state", actorKind: "human" }),
    );

    const agent = dependencies();
    await handleAgentSetScheduleEnabledRequest(
      request("/api/v1/agent/schedules/schedule_1/state", "PATCH", {
        expectedVersion: 0,
        enabled: false,
      }),
      { params: Promise.resolve({ scheduleId: "schedule_1" }) },
      agent,
    );

    expect(agent.activity?.publish).toHaveBeenCalledWith(
      expect.objectContaining({ key: "set_job_alert_state", actorKind: "agent" }),
    );
  });

  it("rejects unauthenticated or cross-origin private mutations", async () => {
    const missingSession = dependencies();
    missingSession.identity.identity.resolveSession = vi.fn(async () => null);
    const unauthorized = await handleCreateSavedSearchRequest(
      request("/api/v1/saved-searches", "POST", { name: "Search" }),
      missingSession,
    );
    expect(unauthorized.status).toBe(401);

    const crossOrigin = dependencies();
    const forbidden = await handleCreateSavedSearchRequest(
      new Request("https://jobbbler.example/api/v1/saved-searches", {
        method: "POST",
        headers: { cookie, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
        body: "{}",
      }),
      crossOrigin,
    );
    expect(forbidden.status).toBe(403);
    expect(crossOrigin.service.createSavedSearch).not.toHaveBeenCalled();
  });

  it("returns a bounded PII-safe latest run only after owner-bound search and schedule lookup", async () => {
    const latestRun = {
      getEvaluation: vi.fn(async () => ({
        id: "evaluation_550e8400-e29b-41d4-a716-446655440000",
        ownerId: owner.id,
        savedSearchId: saved.id,
        scheduleId: schedule.id,
        catalogUpdatedAt: now,
        createdAt: now,
        baseline: [{ jobId: "job_1", fingerprint: "private-fingerprint" }],
      })),
      listChanges: vi.fn(async () =>
        Array.from({ length: 30 }, (_, index) => ({
          id: `change_${String(index)}`,
          evaluationId: "evaluation_550e8400-e29b-41d4-a716-446655440000",
          jobId: `job_${String(index)}`,
          kind: "new" as const,
          createdAt: now,
        })),
      ),
      getLatestDelivery: vi.fn(async () => ({
        id: "delivery_private",
        evaluationId: "evaluation_550e8400-e29b-41d4-a716-446655440000",
        ownerId: owner.id,
        scheduleId: schedule.id,
        endpointId: "endpoint_private",
        contentHash: "private-hash",
        status: "failed" as const,
        attempt: 2,
        providerRef: "private-provider-ref",
        errorCode: "DEPENDENCY",
        acceptedAt: null,
        lastAttemptAt: now,
        version: 2,
        createdAt: now,
        updatedAt: now,
      })),
    };
    const current: SavedSearchRouteDependencies = { ...dependencies(), latestRun };

    const response = await handleGetLatestSavedSearchRunRequest(
      request(`/api/v1/saved-searches/${saved.id}/latest-run`, "GET"),
      { params: Promise.resolve({ savedSearchId: saved.id }) },
      current,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toMatchObject({
      savedSearchId: saved.id,
      evaluation: { baselineCount: 1, changes: { total: 30, truncated: true } },
      delivery: { status: "failed", attempt: 2, errorCode: "DEPENDENCY" },
    });
    expect(payload.data.evaluation.changes.items).toHaveLength(25);
    expect(JSON.stringify(payload.data)).not.toMatch(/fingerprint|endpoint|provider|hash/iu);
    expect(current.service.listSavedSearches).toHaveBeenCalledWith(owner.id);
    expect(current.service.listSchedules).toHaveBeenCalledWith(owner.id);
    expect(latestRun.getLatestDelivery).toHaveBeenCalledWith(schedule.id);
  });

  it("replays saved-search creation for a repeated Idempotency-Key without duplicating", async () => {
    const current = dependencies();
    const body = { name: "Remote TypeScript", criteria: {} };
    const key = "create-2026-08-29-remote-typescript";

    const first = await handleCreateSavedSearchRequest(
      request("/api/v1/saved-searches", "POST", body, { "idempotency-key": key }),
      current,
    );
    const replay = await handleCreateSavedSearchRequest(
      request("/api/v1/saved-searches", "POST", body, { "idempotency-key": key }),
      current,
    );

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    const firstPayload = await first.json();
    const replayPayload = await replay.json();
    expect(replayPayload.data).toEqual(firstPayload.data);
    expect(current.service.createSavedSearch).toHaveBeenCalledTimes(1);
    expect(current.service.deleteSavedSearch).not.toHaveBeenCalled();

    const mismatch = await handleCreateSavedSearchRequest(
      request(
        "/api/v1/saved-searches",
        "POST",
        { ...body, name: "Different" },
        {
          "idempotency-key": key,
        },
      ),
      current,
    );
    expect(mismatch.status).toBe(409);
    expect(current.service.createSavedSearch).toHaveBeenCalledTimes(1);

    const invalid = await handleCreateSavedSearchRequest(
      request("/api/v1/saved-searches", "POST", body, { "idempotency-key": "bad key!" }),
      current,
    );
    expect(invalid.status).toBe(400);
  });

  it("removes a concurrently duplicated saved search and returns the stored original", async () => {
    const current = dependencies();
    const key = "create-2026-08-29-race";
    const stored = { ...saved, id: "saved_550e8400-e29b-41d4-a716-446655440009" };
    current.idempotency.get = vi.fn(async () => null);
    current.idempotency.putIfAbsent = vi.fn(async (record: IdempotencyRecord) => ({
      inserted: false,
      record: { ...record, responseBody: stored },
    }));

    const response = await handleCreateSavedSearchRequest(
      request(
        "/api/v1/saved-searches",
        "POST",
        { name: "Remote TypeScript", criteria: {} },
        { "idempotency-key": key },
      ),
      current,
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.data.id).toBe(stored.id);
    expect(current.service.deleteSavedSearch).toHaveBeenCalledWith(owner.id, saved.id);
  });

  it("updates recurrence and delivery through PATCH while keeping the enabled toggle", async () => {
    const current = dependencies();
    const recurrence = { frequency: "daily" as const, time: "18:00", timeZone: "Europe/Kyiv" };
    const updated = await handleUpdateScheduleRequest(
      request("/api/v1/schedules/schedule_1", "PATCH", { expectedVersion: 0, recurrence }),
      { params: Promise.resolve({ scheduleId: "schedule_1" }) },
      current,
    );
    expect(updated.status).toBe(200);
    expect(current.service.updateSchedule).toHaveBeenCalledWith(
      owner.id,
      "schedule_1",
      { expectedVersion: 0, recurrence },
      now,
    );
    expect(current.service.setScheduleEnabled).not.toHaveBeenCalled();

    const paused = await handleUpdateScheduleRequest(
      request("/api/v1/schedules/schedule_1", "PATCH", { expectedVersion: 1, enabled: false }),
      { params: Promise.resolve({ scheduleId: "schedule_1" }) },
      current,
    );
    expect(paused.status).toBe(200);
    expect(current.service.setScheduleEnabled).toHaveBeenCalledWith(
      owner.id,
      "schedule_1",
      { expectedVersion: 1, enabled: false },
      now,
    );
    expect(current.service.updateSchedule).toHaveBeenCalledTimes(1);
  });

  it("deletes a saved search with its alert only within an owner session", async () => {
    const current = dependencies();
    const response = await handleDeleteSavedSearchRequest(
      request(`/api/v1/saved-searches/${saved.id}`, "DELETE"),
      { params: Promise.resolve({ savedSearchId: saved.id }) },
      current,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual({
      savedSearchId: saved.id,
      scheduleId: schedule.id,
      deleted: true,
    });
    expect(current.service.deleteSavedSearch).toHaveBeenCalledWith(owner.id, saved.id);
    expect(current.activity?.publish).toHaveBeenCalledWith(
      expect.objectContaining({ key: "delete_saved_search", actorKind: "human" }),
    );

    const missingSession = dependencies();
    missingSession.identity.identity.resolveSession = vi.fn(async () => null);
    const unauthorized = await handleDeleteSavedSearchRequest(
      request(`/api/v1/saved-searches/${saved.id}`, "DELETE"),
      { params: Promise.resolve({ savedSearchId: saved.id }) },
      missingSession,
    );
    expect(unauthorized.status).toBe(401);
    expect(missingSession.service.deleteSavedSearch).not.toHaveBeenCalled();

    const crossOrigin = dependencies();
    const forbidden = await handleDeleteSavedSearchRequest(
      new Request(`https://jobbbler.example/api/v1/saved-searches/${saved.id}`, {
        method: "DELETE",
        headers: { cookie, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      }),
      { params: Promise.resolve({ savedSearchId: saved.id }) },
      crossOrigin,
    );
    expect(forbidden.status).toBe(403);
    expect(crossOrigin.service.deleteSavedSearch).not.toHaveBeenCalled();
  });

  it("requires an exact confirmation and idempotency key for agent deletion", async () => {
    const missingKey = dependencies();
    const missingKeyResponse = await handleAgentDeleteSavedSearchRequest(
      request(`/api/v1/agent/saved-searches/${saved.id}`, "DELETE", {
        confirmation: "DELETE_SAVED_SEARCH_AND_ALERT",
      }),
      { params: Promise.resolve({ savedSearchId: saved.id }) },
      missingKey,
    );
    expect(missingKeyResponse.status).toBe(400);
    expect(missingKey.service.deleteSavedSearch).not.toHaveBeenCalled();

    for (const body of [
      {},
      { confirmation: "delete" },
      { confirmation: "DELETE_SAVED_SEARCH_AND_ALERT", enabled: false },
    ]) {
      const invalid = dependencies();
      const invalidResponse = await handleAgentDeleteSavedSearchRequest(
        request(`/api/v1/agent/saved-searches/${saved.id}`, "DELETE", body, {
          "idempotency-key": "delete-exact-alert",
        }),
        { params: Promise.resolve({ savedSearchId: saved.id }) },
        invalid,
      );
      expect(invalidResponse.status).toBe(400);
      expect(invalid.service.deleteSavedSearch).not.toHaveBeenCalled();
    }
  });

  it("replays one bounded agent deletion receipt and records agent attribution", async () => {
    const current = dependencies();
    let deleted = false;
    current.service.deleteSavedSearch = vi.fn(async () => {
      if (deleted) {
        throw new DomainError({ code: "NOT_FOUND", message: "Saved search was not found." });
      }
      deleted = true;
      return { savedSearch: saved, schedule };
    });
    const body = { confirmation: "DELETE_SAVED_SEARCH_AND_ALERT" };
    const headers = { "idempotency-key": "delete-exact-alert" };
    const routeContext = { params: Promise.resolve({ savedSearchId: saved.id }) };
    const first = await handleAgentDeleteSavedSearchRequest(
      request(`/api/v1/agent/saved-searches/${saved.id}`, "DELETE", body, headers),
      routeContext,
      current,
    );
    const replay = await handleAgentDeleteSavedSearchRequest(
      request(`/api/v1/agent/saved-searches/${saved.id}`, "DELETE", body, headers),
      routeContext,
      current,
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    const firstPayload = await first.json();
    const replayPayload = await replay.json();
    expect(firstPayload.data).toEqual({
      savedSearchId: saved.id,
      scheduleId: schedule.id,
      deleted: true,
    });
    expect(replayPayload.data).toEqual(firstPayload.data);
    expect(JSON.stringify(firstPayload)).not.toMatch(/email|endpoint/iu);
    expect(new TextEncoder().encode(JSON.stringify(firstPayload.data)).byteLength).toBeLessThan(
      256,
    );
    expect(current.service.deleteSavedSearch).toHaveBeenCalledTimes(2);
    expect(current.activity?.publish).toHaveBeenCalledTimes(1);
    expect(current.activity?.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "delete_saved_search",
        actorKind: "agent",
        safeSummary: "Saved search and its job alert were removed.",
      }),
    );

    const mismatch = await handleAgentDeleteSavedSearchRequest(
      request(
        "/api/v1/agent/saved-searches/saved_550e8400-e29b-41d4-a716-446655440009",
        "DELETE",
        body,
        headers,
      ),
      {
        params: Promise.resolve({
          savedSearchId: "saved_550e8400-e29b-41d4-a716-446655440009",
        }),
      },
      current,
    );
    expect(mismatch.status).toBe(409);
    expect(current.service.deleteSavedSearch).toHaveBeenCalledTimes(2);
  });

  it("does not mutate until the deletion receipt is durably claimed", async () => {
    const current = dependencies();
    let deleted = false;
    current.service.listSavedSearches = vi.fn(async () => (deleted ? [] : [saved]));
    current.service.listSchedules = vi.fn(async () => (deleted ? [] : [schedule]));
    current.service.deleteSavedSearch = vi.fn(async () => {
      if (deleted) {
        throw new DomainError({ code: "NOT_FOUND", message: "Saved search was not found." });
      }
      deleted = true;
      return { savedSearch: saved, schedule };
    });
    const put = current.idempotency.putIfAbsent;
    current.idempotency.putIfAbsent = vi
      .fn()
      .mockRejectedValueOnce(new Error("receipt store unavailable"))
      .mockImplementation(put);
    const body = { confirmation: "DELETE_SAVED_SEARCH_AND_ALERT" };
    const headers = { "idempotency-key": "uncertain-delete-alert" };
    const routeContext = { params: Promise.resolve({ savedSearchId: saved.id }) };

    const uncertain = await handleAgentDeleteSavedSearchRequest(
      request(`/api/v1/agent/saved-searches/${saved.id}`, "DELETE", body, headers),
      routeContext,
      current,
    );
    expect(uncertain.status).toBe(500);
    expect(current.service.deleteSavedSearch).not.toHaveBeenCalled();
    expect(current.activity?.publish).not.toHaveBeenCalled();

    const retry = await handleAgentDeleteSavedSearchRequest(
      request(`/api/v1/agent/saved-searches/${saved.id}`, "DELETE", body, headers),
      routeContext,
      current,
    );

    expect(retry.status).toBe(200);
    expect((await retry.json()).data).toEqual({
      savedSearchId: saved.id,
      scheduleId: schedule.id,
      deleted: true,
    });
    expect(current.service.deleteSavedSearch).toHaveBeenCalledTimes(1);
    expect(current.activity?.publish).toHaveBeenCalledTimes(1);
  });

  it("coordinates concurrent same-key agent deletions and publishes one activity", async () => {
    const current = dependencies();
    let deleted = false;
    let getCount = 0;
    let releaseInitialReads: () => void = () => undefined;
    const bothInitialReads = new Promise<void>((resolve) => {
      releaseInitialReads = resolve;
    });
    current.idempotency.get = vi.fn(async () => {
      getCount += 1;
      if (getCount === 2) releaseInitialReads();
      await bothInitialReads;
      return null;
    });
    current.service.deleteSavedSearch = vi.fn(async () => {
      if (deleted) {
        throw new DomainError({ code: "NOT_FOUND", message: "Saved search was not found." });
      }
      deleted = true;
      return { savedSearch: saved, schedule };
    });
    const body = { confirmation: "DELETE_SAVED_SEARCH_AND_ALERT" };
    const headers = { "idempotency-key": "concurrent-delete-alert" };
    const routeContext = { params: Promise.resolve({ savedSearchId: saved.id }) };

    const first = handleAgentDeleteSavedSearchRequest(
      request(`/api/v1/agent/saved-searches/${saved.id}`, "DELETE", body, headers),
      routeContext,
      current,
    );
    const concurrentReplay = handleAgentDeleteSavedSearchRequest(
      request(`/api/v1/agent/saved-searches/${saved.id}`, "DELETE", body, headers),
      routeContext,
      current,
    );
    const [firstResponse, replayResponse] = await Promise.all([first, concurrentReplay]);

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    expect((await replayResponse.json()).data).toEqual((await firstResponse.json()).data);
    expect(current.idempotency.putIfAbsent).toHaveBeenCalledTimes(2);
    expect(current.service.deleteSavedSearch).toHaveBeenCalledTimes(2);
    expect(current.activity?.publish).toHaveBeenCalledTimes(1);
  });

  it("does not reveal a saved search outside the current owner during agent deletion", async () => {
    const current = dependencies();
    current.service.listSavedSearches = vi.fn(async () => []);
    current.service.listSchedules = vi.fn(async () => []);
    current.service.deleteSavedSearch = vi.fn(async () => {
      throw new DomainError({ code: "NOT_FOUND", message: "Saved search was not found." });
    });
    const response = await handleAgentDeleteSavedSearchRequest(
      request(
        `/api/v1/agent/saved-searches/${saved.id}`,
        "DELETE",
        {
          confirmation: "DELETE_SAVED_SEARCH_AND_ALERT",
        },
        { "idempotency-key": "delete-other-owner-alert" },
      ),
      { params: Promise.resolve({ savedSearchId: saved.id }) },
      current,
    );

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error).toMatchObject({ code: "NOT_FOUND" });
    expect(JSON.stringify(payload)).not.toMatch(/owner_|email|endpoint/iu);
    expect(current.idempotency.putIfAbsent).not.toHaveBeenCalled();
    expect(current.service.deleteSavedSearch).not.toHaveBeenCalled();
    expect(current.activity?.publish).not.toHaveBeenCalled();
  });
});
