import { describe, expect, it, vi } from "vitest";

import type { IdentityRouteDependencies } from "./identity-route-handlers";
import {
  handleCreateSavedSearchRequest,
  handleCreateScheduleRequest,
  handleGetLatestSavedSearchRunRequest,
  handleListSavedSearchesRequest,
  handleListSchedulesRequest,
  handlePreviewScheduleRequest,
  handleSetScheduleEnabledRequest,
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

function dependencies(): SavedSearchRouteDependencies {
  return {
    identity: identity(),
    service: {
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
    },
  };
}

function request(path: string, method: string, body?: unknown): Request {
  return new Request(`https://jobbbler.example${path}`, {
    method,
    headers: {
      cookie,
      ...(method === "GET"
        ? {}
        : {
            origin: "https://jobbbler.example",
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
          }),
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
});
