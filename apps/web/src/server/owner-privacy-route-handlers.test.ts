import { describe, expect, it, vi } from "vitest";

import type { ResolvedOwnerSession } from "@jobbbler/core-domain";

import type { IdentityRouteDependencies } from "./identity-route-handlers";
import {
  handleCompleteOwnerDeletionRequest,
  handleCompleteOwnerRecoveryRequest,
  handleStartOwnerDeletionRequest,
  handleStartOwnerRecoveryRequest,
} from "./owner-privacy-route-handlers";

const now = "2026-08-29T10:00:00.000Z";
const owner = {
  id: "owner_550e8400-e29b-41d4-a716-446655440000",
  kind: "guest" as const,
  verified: true,
  version: 2,
  createdAt: now,
  updatedAt: now,
};
const session = {
  id: "session_550e8400-e29b-41d4-a716-446655440001",
  ownerId: owner.id,
  tokenHash: "stored-session-hash",
  status: "active" as const,
  expiresAt: "2026-09-05T10:00:00.000Z",
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
};
const rawSession = "recovered-session-secret-with-at-least-thirty-two-characters";

function request(path: string, body: unknown, headers: HeadersInit = {}): Request {
  return new Request(`https://jobbbler.example${path}`, {
    method: "POST",
    headers: {
      origin: "https://jobbbler.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function dependencies(
  options: {
    readonly resolved?: ResolvedOwnerSession | null;
    readonly encryptedAddress?: string | null;
    readonly deliveryError?: boolean;
  } = {},
): IdentityRouteDependencies {
  return {
    identity: {
      createEphemeralSession: vi.fn(),
      resolveSession: vi.fn(async () => options.resolved ?? null),
      startEmailVerification: vi.fn(),
      completeEmailVerification: vi.fn(),
      listVerificationEndpoints: vi.fn(async () => []),
      revokeVerificationEndpoint: vi.fn(),
      startOwnerRecovery: vi.fn(async () => ({
        recoveryId: "recovery_550e8400-e29b-41d4-a716-446655440002",
        rawCode: "372941",
        expiresAt: "2026-08-29T10:10:00.000Z",
        encryptedAddress: options.encryptedAddress ?? null,
      })),
      completeOwnerRecovery: vi.fn(async () => ({
        owner,
        sessionId: session.id,
        rawToken: rawSession,
        expiresAt: session.expiresAt,
      })),
      startOwnerDeletion: vi.fn(async () => ({
        id: "deletion_550e8400-e29b-41d4-a716-446655440003",
        ownerId: owner.id,
        status: "pending" as const,
        expiresAt: "2026-08-29T10:05:00.000Z",
        createdAt: now,
        updatedAt: now,
      })),
      completeOwnerDeletion: vi.fn(async () => ({ deleted: true as const })),
    },
    delivery: {
      deliverVerification: vi.fn(async () => {
        if (options.deliveryError === true) throw new Error("provider unavailable");
        return { delivery: "captured" as const };
      }),
    },
    environment: {
      NODE_ENV: "test",
      PUBLIC_BASE_URL: "https://jobbbler.example",
      NOTIFICATION_DRIVER: "capture",
      ALLOW_LOCAL_OTP_CAPTURE: "true",
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

describe("owner recovery route handlers", () => {
  it("returns one enumeration-resistant accepted envelope for known and unknown emails", async () => {
    const known = dependencies({ encryptedAddress: "protected-email-envelope" });
    const unknown = dependencies({ encryptedAddress: null });
    const knownResponse = await handleStartOwnerRecoveryRequest(
      request("/api/v1/owners/recovery/start", { email: "person@example.com" }),
      known,
    );
    const unknownResponse = await handleStartOwnerRecoveryRequest(
      request("/api/v1/owners/recovery/start", { email: "unknown@example.com" }),
      unknown,
    );

    expect(knownResponse.status).toBe(202);
    expect(unknownResponse.status).toBe(202);
    const knownBody = await knownResponse.json();
    const unknownBody = await unknownResponse.json();
    expect(knownBody.data).toEqual(unknownBody.data);
    expect(JSON.stringify(knownBody)).not.toContain("person@example.com");
    expect(known.delivery.deliverVerification).toHaveBeenCalledOnce();
    expect(unknown.delivery.deliverVerification).not.toHaveBeenCalled();
  });

  it("does not reveal provider failure for an existing recovery destination", async () => {
    const current = dependencies({
      encryptedAddress: "protected-email-envelope",
      deliveryError: true,
    });
    const response = await handleStartOwnerRecoveryRequest(
      request("/api/v1/owners/recovery/start", { email: "person@example.com" }),
      current,
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      data: { delivery: "accepted", developmentCode: "372941" },
    });
  });

  it("can defer recovery delivery until after the response without changing its envelope", async () => {
    const current = dependencies({ encryptedAddress: "protected-email-envelope" });
    let deferred: (() => Promise<void>) | undefined;
    const response = await handleStartOwnerRecoveryRequest(
      request("/api/v1/owners/recovery/start", { email: "person@example.com" }),
      current,
      (task) => {
        deferred = task;
      },
    );

    expect(response.status).toBe(202);
    expect(current.delivery.deliverVerification).not.toHaveBeenCalled();
    expect(deferred).toBeTypeOf("function");
    await deferred?.();
    expect(current.delivery.deliverVerification).toHaveBeenCalledOnce();
  });

  it("sets the rotated opaque HttpOnly session only after successful recovery", async () => {
    const current = dependencies();
    const response = await handleCompleteOwnerRecoveryRequest(
      request("/api/v1/owners/recovery/complete", {
        recoveryId: "recovery_550e8400-e29b-41d4-a716-446655440002",
        code: "372941",
      }),
      current,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`jobbbler_owner=${rawSession}`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(JSON.stringify(await response.json())).not.toContain(rawSession);
    expect(current.activity.append).toHaveBeenCalledOnce();
    const published = JSON.stringify(vi.mocked(current.activity.append).mock.calls[0]?.[0].event);
    expect(published).toContain("Private workspace access recovered.");
    expect(published).not.toContain("372941");
    expect(published).not.toContain("recovery_550e8400");
    expect(published).not.toContain(rawSession);
    expect(vi.mocked(current.activity.append).mock.calls[0]?.[0].event.correlationId).toBe(
      response.headers.get("x-request-id"),
    );
  });

  it("applies durable rate limits before attempting recovery completion", async () => {
    const current = dependencies();
    vi.mocked(current.rateLimiter.check).mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 19,
      resetAtMs: Date.parse(now) + 19_000,
    });
    const response = await handleCompleteOwnerRecoveryRequest(
      request("/api/v1/owners/recovery/complete", {
        recoveryId: "recovery_550e8400-e29b-41d4-a716-446655440002",
        code: "372941",
      }),
      current,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("19");
    expect(current.identity.completeOwnerRecovery).not.toHaveBeenCalled();
  });
});

describe("owner private-data deletion route handlers", () => {
  it("requires the live human session for both explicit deletion steps", async () => {
    const unauthenticated = dependencies({ resolved: null });
    const denied = await handleStartOwnerDeletionRequest(
      request("/api/v1/owners/deletion", { confirmation: "DELETE MY PRIVATE DATA" }),
      unauthenticated,
    );
    expect(denied.status).toBe(401);
    expect(unauthenticated.identity.startOwnerDeletion).not.toHaveBeenCalled();

    const current = dependencies({ resolved: { owner, session } });
    const started = await handleStartOwnerDeletionRequest(
      request(
        "/api/v1/owners/deletion",
        { confirmation: "DELETE MY PRIVATE DATA" },
        { cookie: "jobbbler_owner=current-private-session-secret-with-enough-entropy" },
      ),
      current,
    );
    expect(started.status).toBe(201);
    await expect(started.json()).resolves.toMatchObject({
      data: {
        deletionId: "deletion_550e8400-e29b-41d4-a716-446655440003",
        expiresAt: "2026-08-29T10:05:00.000Z",
      },
    });
    expect(current.activity.append).toHaveBeenCalledOnce();
    const published = JSON.stringify(vi.mocked(current.activity.append).mock.calls[0]?.[0].event);
    expect(published).toContain("Final human confirmation is required to delete private data.");
    expect(published).not.toContain("deletion_550e8400");
    expect(vi.mocked(current.activity.append).mock.calls[0]?.[0].event.correlationId).toBe(
      started.headers.get("x-request-id"),
    );
  });

  it("deletes through the current session and clears its cookie", async () => {
    const current = dependencies({ resolved: { owner, session } });
    const response = await handleCompleteOwnerDeletionRequest(
      request(
        "/api/v1/owners/deletion/complete",
        {
          deletionId: "deletion_550e8400-e29b-41d4-a716-446655440003",
          confirmation: "DELETE",
        },
        { cookie: "jobbbler_owner=current-private-session-secret-with-enough-entropy" },
      ),
      current,
    );
    expect(response.status).toBe(200);
    expect(current.identity.completeOwnerDeletion).toHaveBeenCalledWith(
      owner.id,
      session.id,
      expect.objectContaining({ confirmation: "DELETE" }),
      now,
    );
    expect(response.headers.get("set-cookie")).toContain("jobbbler_owner=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    await expect(response.json()).resolves.toMatchObject({ data: { deleted: true } });
  });

  it("rejects cross-origin and oversized destructive requests before mutation", async () => {
    const current = dependencies({ resolved: { owner, session } });
    const crossOrigin = await handleStartOwnerDeletionRequest(
      request(
        "/api/v1/owners/deletion",
        { confirmation: "DELETE MY PRIVATE DATA" },
        { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      ),
      current,
    );
    expect(crossOrigin.status).toBe(403);
    const oversized = new Request("https://jobbbler.example/api/v1/owners/deletion", {
      method: "POST",
      headers: {
        origin: "https://jobbbler.example",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirmation: "DELETE MY PRIVATE DATA", padding: "x".repeat(5_000) }),
    });
    expect((await handleStartOwnerDeletionRequest(oversized, current)).status).toBe(400);
    expect(current.identity.startOwnerDeletion).not.toHaveBeenCalled();
  });
});
