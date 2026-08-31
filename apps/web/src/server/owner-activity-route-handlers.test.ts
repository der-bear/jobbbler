import { describe, expect, it, vi } from "vitest";

import type { ResolvedOwnerSession } from "@jobbbler/core-domain";
import type { OwnerActivityRepository } from "@jobbbler/storage";

import type { IdentityRouteDependencies } from "./identity-route-handlers";
import {
  createOwnerActivityCursorCodec,
  handleClearOwnerActivityRequest,
  handleListOwnerActivityRequest,
  type OwnerActivityRouteDependencies,
} from "./owner-activity-route-handlers";

const now = "2026-08-29T10:00:00.000Z";
const owner = {
  id: "owner_550e8400-e29b-41d4-a716-446655440000",
  kind: "guest" as const,
  verified: true,
  version: 1,
  createdAt: now,
  updatedAt: now,
};
const otherOwner = { ...owner, id: "owner_550e8400-e29b-41d4-a716-446655440001" };
const session = {
  id: "session_550e8400-e29b-41d4-a716-446655440000",
  ownerId: owner.id,
  tokenHash: "hash",
  status: "active" as const,
  expiresAt: "2026-09-05T10:00:00.000Z",
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
};
const event = {
  id: "activity_550e8400-e29b-41d4-a716-446655440000",
  schemaVersion: 1 as const,
  kind: "tool" as const,
  key: "edit_application",
  status: "completed" as const,
  safeSummary: "Application draft updated.",
  correlationId: "corr_550e8400-e29b-41d4-a716-446655440000",
  actorKind: "agent" as const,
  aggregate: { type: "application_draft" as const, version: 3 },
  occurredAt: now,
  effects: [{ target: "application" as const, kind: "refresh" as const }],
};
const environment = {
  NODE_ENV: "test",
  PUBLIC_BASE_URL: "https://jobbbler.example",
  TOKEN_HASH_SECRET: "owner-activity-test-secret-at-least-32-characters",
};

function identity(
  resolved: ResolvedOwnerSession | null = { owner, session },
): IdentityRouteDependencies {
  return {
    identity: {
      createEphemeralSession: vi.fn(),
      resolveSession: vi.fn(async () => resolved),
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
    environment,
    now: () => now,
    nowMs: () => Date.parse(now),
    rateLimiter: {
      check: vi.fn(async () => ({
        allowed: true,
        remaining: 119,
        retryAfterSeconds: 0,
        resetAtMs: Date.parse(now) + 60_000,
      })),
    },
    activity: { append: vi.fn() },
  };
}

function dependencies(
  options: Readonly<{
    resolved?: ResolvedOwnerSession | null;
    activity?: Partial<OwnerActivityRepository>;
  }> = {},
): OwnerActivityRouteDependencies {
  const ownerIdentity = identity(
    options.resolved === undefined ? { owner, session } : options.resolved,
  );
  return {
    identity: ownerIdentity,
    activity: {
      append: vi.fn(),
      clear: vi.fn(async () => 0),
      listWindow: vi.fn(async () => ({
        events: [{ sequence: 7, ownerId: owner.id, event }],
        hasMore: false,
        latestSequence: 7,
      })),
      ...options.activity,
    },
    cursor: createOwnerActivityCursorCodec(environment),
    pollAfterMs: 5_000,
  };
}

function request(query = "", headers: HeadersInit = {}): Request {
  return new Request(`https://jobbbler.example/api/v1/owners/activity${query}`, {
    headers: {
      cookie: "jobbbler_owner=session-secret-with-at-least-thirty-two-characters",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  });
}

function clearRequest(headers: HeadersInit = {}): Request {
  return new Request("https://jobbbler.example/api/v1/owners/activity", {
    method: "DELETE",
    headers: {
      cookie: "jobbbler_owner=session-secret-with-at-least-thirty-two-characters",
      origin: "https://jobbbler.example",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  });
}

describe("owner activity cursor", () => {
  it("is opaque, tamper evident, and bound to the exact owner", () => {
    const codec = createOwnerActivityCursorCodec(environment);
    const cursor = codec.encode(owner.id, 42);
    expect(cursor).not.toContain(owner.id);
    expect(codec.decode(owner.id, cursor)).toBe(42);
    expect(() => codec.decode(otherOwner.id, cursor)).toThrowError(
      expect.objectContaining({ code: "VALIDATION" }),
    );
    expect(() => codec.decode(owner.id, `${cursor.slice(0, -1)}x`)).toThrowError(
      expect.objectContaining({ code: "VALIDATION" }),
    );
  });
});

describe("owner activity route handler", () => {
  it("clears only the resolved owner's activity and returns a private receipt", async () => {
    const clear = vi.fn(async () => 4);
    const current = dependencies({ activity: { clear } });

    const response = await handleClearOwnerActivityRequest(clearRequest(), current);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(clear).toHaveBeenCalledWith(owner.id, "agent");
    expect((await response.json()).data).toEqual({ clearedCount: 4 });
  });

  it("rejects unauthenticated and cross-origin history clearing", async () => {
    const clear = vi.fn(async () => 4);
    const unauthorized = await handleClearOwnerActivityRequest(
      clearRequest(),
      dependencies({ resolved: null, activity: { clear } }),
    );
    const crossOrigin = await handleClearOwnerActivityRequest(
      clearRequest({ origin: "https://attacker.example", "sec-fetch-site": "cross-site" }),
      dependencies({ activity: { clear } }),
    );

    expect(unauthorized.status).toBe(401);
    expect(crossOrigin.status).toBe(403);
    expect(clear).not.toHaveBeenCalled();
  });

  it("requires an owner session before reading the projection", async () => {
    const activity = { listWindow: vi.fn() };
    const response = await handleListOwnerActivityRequest(
      request(),
      dependencies({ resolved: null, activity }),
    );
    expect(response.status).toBe(401);
    expect(activity.listWindow).not.toHaveBeenCalled();
  });

  it("reads only the resolved owner and removes persistence identifiers", async () => {
    const dependenciesForRequest = dependencies();
    const response = await handleListOwnerActivityRequest(
      request("?limit=25"),
      dependenciesForRequest,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(dependenciesForRequest.activity.listWindow).toHaveBeenCalledWith({
      ownerId: owner.id,
      afterSequence: null,
      limit: 25,
      actorKind: "agent",
    });
    const body = await response.json();
    expect(body.data).toMatchObject({
      events: [event],
      hasMore: false,
      resyncRequired: false,
      pollAfterMs: 5_000,
    });
    expect(body.data.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain(owner.id);
    expect(JSON.stringify(body)).not.toContain("sequence");
    const rateLimitKey = vi.mocked(dependenciesForRequest.identity.rateLimiter.check).mock
      .calls[0]?.[0].key;
    expect(rateLimitKey).toHaveLength(64);
    expect(rateLimitKey).not.toContain(owner.id);
  });

  it("rejects cross-site reads, malformed limits, and owner-mismatched cursors", async () => {
    const crossSite = await handleListOwnerActivityRequest(
      request("", { "sec-fetch-site": "cross-site" }),
      dependencies(),
    );
    expect(crossSite.status).toBe(403);
    expect(
      (await handleListOwnerActivityRequest(request("?limit=101"), dependencies())).status,
    ).toBe(400);
    const otherCursor = createOwnerActivityCursorCodec(environment).encode(otherOwner.id, 4);
    expect(
      (
        await handleListOwnerActivityRequest(
          request(`?cursor=${encodeURIComponent(otherCursor)}`),
          dependencies(),
        )
      ).status,
    ).toBe(400);
  });

  it("returns an authoritative snapshot when a signed cursor is ahead of retained state", async () => {
    const cursor = createOwnerActivityCursorCodec(environment).encode(owner.id, 12);
    const listWindow = vi
      .fn()
      .mockResolvedValueOnce({ events: [], hasMore: false, latestSequence: 7 })
      .mockResolvedValueOnce({
        events: [{ sequence: 7, ownerId: owner.id, event }],
        hasMore: false,
        latestSequence: 7,
      });
    const response = await handleListOwnerActivityRequest(
      request(`?cursor=${encodeURIComponent(cursor)}`),
      dependencies({ activity: { listWindow } }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      events: [event],
      resyncRequired: true,
    });
    expect(listWindow).toHaveBeenNthCalledWith(2, {
      ownerId: owner.id,
      afterSequence: null,
      limit: 50,
      actorKind: "agent",
    });
  });

  it("fails closed when the storage projection exposes an impossible cursor window", async () => {
    const response = await handleListOwnerActivityRequest(
      request(),
      dependencies({
        activity: {
          listWindow: vi.fn(async () => ({
            events: [],
            hasMore: true,
            latestSequence: Number.NaN,
          })),
        },
      }),
    );

    expect(response.status).toBe(409);
  });

  it("returns a durable retry boundary without reading when rate limited", async () => {
    const deps = dependencies();
    vi.mocked(deps.identity.rateLimiter.check).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 17,
      resetAtMs: Date.parse(now) + 17_000,
    });
    const response = await handleListOwnerActivityRequest(request(), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(deps.activity.listWindow).not.toHaveBeenCalled();
  });
});
