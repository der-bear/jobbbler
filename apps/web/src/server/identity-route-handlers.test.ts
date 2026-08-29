import { describe, expect, it, vi } from "vitest";

import type { ResolvedOwnerSession } from "@jobbbler/core-domain";

import {
  handleCompleteEmailVerificationRequest,
  handleCreateOwnerSessionRequest,
  handleGetOwnerSessionRequest,
  handleListVerificationEndpointsRequest,
  handleRevokeVerificationEndpointRequest,
  handleStartEmailVerificationRequest,
  readSmallJsonBody,
  type IdentityRouteDependencies,
} from "./identity-route-handlers";

const now = "2026-08-29T10:00:00.000Z";
const owner = {
  id: "owner_550e8400-e29b-41d4-a716-446655440000",
  kind: "ephemeral" as const,
  verified: false,
  version: 0,
  createdAt: now,
  updatedAt: now,
};
const session = {
  id: "session_550e8400-e29b-41d4-a716-446655440001",
  ownerId: owner.id,
  tokenHash: "stored-hash",
  status: "active" as const,
  expiresAt: "2026-09-05T10:00:00.000Z",
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
};

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://jobbbler.example${path}`, {
    ...init,
    headers: {
      origin: "https://jobbbler.example",
      "sec-fetch-site": "same-origin",
      ...init.headers,
    },
  });
}

function dependencies(
  overrides: Partial<IdentityRouteDependencies> = {},
): IdentityRouteDependencies {
  return {
    identity: {
      createEphemeralSession: vi.fn(async () => ({
        owner,
        sessionId: session.id,
        rawToken: "session-secret-with-at-least-thirty-two-characters",
        expiresAt: session.expiresAt,
      })),
      resolveSession: vi.fn(async (): Promise<ResolvedOwnerSession | null> => null),
      startEmailVerification: vi.fn(async () => ({
        challengeId: "challenge_550e8400-e29b-41d4-a716-446655440002",
        endpointId: "endpoint_550e8400-e29b-41d4-a716-446655440003",
        rawCode: "372941",
        expiresAt: "2026-08-29T10:10:00.000Z",
        maskedAddress: "p•••••@example.com",
        encryptedAddress: "protected-email-envelope",
      })),
      completeEmailVerification: vi.fn(async () => ({
        owner: { id: owner.id, kind: "guest" as const, verified: true, recoverable: true },
        endpointId: "endpoint_550e8400-e29b-41d4-a716-446655440003",
        verifiedAt: now,
      })),
      listVerificationEndpoints: vi.fn(async () => []),
      revokeVerificationEndpoint: vi.fn(),
      startOwnerRecovery: vi.fn(),
      completeOwnerRecovery: vi.fn(),
      startOwnerDeletion: vi.fn(),
      completeOwnerDeletion: vi.fn(),
    },
    delivery: {
      deliverVerification: vi.fn(async () => ({ delivery: "captured" as const })),
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
    ...overrides,
  };
}

describe("owner identity route handlers", () => {
  it("creates an ephemeral owner on the first private action and sets only an HttpOnly cookie", async () => {
    const response = await handleCreateOwnerSessionRequest(
      request("/api/v1/owners/session", { method: "POST" }),
      dependencies(),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain(
      "jobbbler_owner=session-secret-with-at-least-thirty-two-characters",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain("session-secret");
    expect(serialized).toContain('"kind":"ephemeral"');
  });

  it("reuses the current owner instead of creating a second session", async () => {
    const current = dependencies({
      identity: {
        ...dependencies().identity,
        resolveSession: vi.fn(async () => ({ owner, session })),
      },
    });
    const response = await handleCreateOwnerSessionRequest(
      request("/api/v1/owners/session", {
        method: "POST",
        headers: { cookie: "jobbbler_owner=existing-session-secret-with-thirty-two-characters" },
      }),
      current,
    );

    expect(response.status).toBe(200);
    expect(current.identity.createEphemeralSession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns the current non-secret owner state", async () => {
    const current = dependencies({
      identity: {
        ...dependencies().identity,
        resolveSession: vi.fn(async () => ({ owner, session })),
      },
    });
    const response = await handleGetOwnerSessionRequest(
      request("/api/v1/owners/session", {
        headers: { cookie: "jobbbler_owner=existing-session-secret-with-thirty-two-characters" },
      }),
      current,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { owner: { id: owner.id, recoverable: false }, expiresAt: session.expiresAt },
    });
  });

  it("delivers a verification code after persistence without exposing protected email data", async () => {
    const identity = dependencies().identity;
    const current = dependencies({
      identity: {
        ...identity,
        resolveSession: vi.fn(async () => ({ owner, session })),
      },
    });
    const response = await handleStartEmailVerificationRequest(
      request("/api/v1/owners/email/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "jobbbler_owner=existing-session-secret-with-thirty-two-characters",
        },
        body: JSON.stringify({ email: "Person@Example.com" }),
      }),
      current,
    );

    expect(response.status).toBe(202);
    expect(current.delivery.deliverVerification).toHaveBeenCalledWith({
      encryptedAddress: "protected-email-envelope",
      code: "372941",
      expiresAt: "2026-08-29T10:10:00.000Z",
      challengeId: "challenge_550e8400-e29b-41d4-a716-446655440002",
    });
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain('"developmentCode":"372941"');
    expect(serialized).not.toContain("protected-email-envelope");
    expect(serialized).not.toContain("Person@Example.com");
  });

  it("never returns a development code in production", async () => {
    const current = dependencies({
      identity: {
        ...dependencies().identity,
        resolveSession: vi.fn(async () => ({ owner, session })),
      },
      environment: {
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://jobbbler.example",
        NOTIFICATION_DRIVER: "resend",
      },
      delivery: {
        deliverVerification: vi.fn(async () => ({ delivery: "queued" as const })),
      },
    });
    const response = await handleStartEmailVerificationRequest(
      request("/api/v1/owners/email/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-jobbbler_owner=existing-session-secret-with-thirty-two-characters",
        },
        body: JSON.stringify({ email: "person@example.com" }),
      }),
      current,
    );

    expect(JSON.stringify(await response.json())).not.toContain("372941");
  });

  it("fails closed on captured codes outside explicit local or test mode", async () => {
    const current = dependencies({
      identity: {
        ...dependencies().identity,
        resolveSession: vi.fn(async () => ({ owner, session })),
      },
      environment: {
        NODE_ENV: "development",
        PUBLIC_BASE_URL: "https://preview.jobbbler.example",
        NOTIFICATION_DRIVER: "capture",
        ALLOW_LOCAL_OTP_CAPTURE: "true",
      },
    });
    const response = await handleStartEmailVerificationRequest(
      request("/api/v1/owners/email/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "jobbbler_owner=existing-session-secret-with-thirty-two-characters",
        },
        body: JSON.stringify({ email: "person@example.com" }),
      }),
      current,
    );
    expect(JSON.stringify(await response.json())).not.toContain("372941");
  });

  it("rate-limits identity creation before writing a new owner", async () => {
    const current = dependencies({
      rateLimiter: {
        check: vi.fn(async () => ({
          allowed: false,
          remaining: 0,
          retryAfterSeconds: 45,
          resetAtMs: Date.parse(now) + 45_000,
        })),
      },
    });
    const response = await handleCreateOwnerSessionRequest(
      request("/api/v1/owners/session", { method: "POST" }),
      current,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("45");
    expect(current.identity.createEphemeralSession).not.toHaveBeenCalled();
  });

  it("completes verification only for the owner session holding the challenge", async () => {
    const current = dependencies({
      identity: {
        ...dependencies().identity,
        resolveSession: vi.fn(async () => ({ owner, session })),
      },
    });
    const response = await handleCompleteEmailVerificationRequest(
      request("/api/v1/owners/email/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "jobbbler_owner=existing-session-secret-with-thirty-two-characters",
        },
        body: JSON.stringify({
          challengeId: "challenge_550e8400-e29b-41d4-a716-446655440002",
          code: "372941",
        }),
      }),
      current,
    );

    expect(response.status).toBe(200);
    expect(current.identity.completeEmailVerification).toHaveBeenCalledWith(
      owner.id,
      expect.objectContaining({ code: "372941" }),
      now,
    );
  });

  it("lists and revokes only masked owner endpoints", async () => {
    const endpoint = {
      id: "endpoint_550e8400-e29b-41d4-a716-446655440003",
      kind: "email" as const,
      maskedAddress: "p•••••@example.com",
      status: "verified" as const,
      verifiedAt: now,
    };
    const current = dependencies({
      identity: {
        ...dependencies().identity,
        resolveSession: vi.fn(async () => ({ owner, session })),
        listVerificationEndpoints: vi.fn(async () => [endpoint]),
        revokeVerificationEndpoint: vi.fn(async () => ({
          ...endpoint,
          status: "revoked" as const,
        })),
      },
    });
    const listed = await handleListVerificationEndpointsRequest(
      request("/api/v1/owners/email", {
        headers: { cookie: "jobbbler_owner=existing-session-secret-with-thirty-two-characters" },
      }),
      current,
    );
    expect(JSON.stringify(await listed.json())).not.toContain("Address");
    const revoked = await handleRevokeVerificationEndpointRequest(
      request(`/api/v1/owners/email/${endpoint.id}`, {
        method: "DELETE",
        headers: { cookie: "jobbbler_owner=existing-session-secret-with-thirty-two-characters" },
      }),
      { params: Promise.resolve({ endpointId: endpoint.id }) },
      current,
    );
    await expect(revoked.json()).resolves.toMatchObject({
      ok: true,
      data: { id: endpoint.id, status: "revoked", maskedDestination: endpoint.maskedAddress },
    });
  });

  it("rejects cross-origin mutation attempts before creating identity state", async () => {
    const current = dependencies();
    const response = await handleCreateOwnerSessionRequest(
      new Request("https://jobbbler.example/api/v1/owners/session", {
        method: "POST",
        headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      }),
      current,
    );

    expect(response.status).toBe(403);
    expect(current.identity.createEphemeralSession).not.toHaveBeenCalled();
  });

  it("stops reading a streamed JSON body as soon as the byte cap is exceeded", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1_024).fill(120));
        if (pulls === 100) controller.close();
      },
    });
    const oversized = new Request("https://jobbbler.example/api/v1/owners/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { readonly duplex: "half" });

    await expect(readSmallJsonBody(oversized)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(pulls).toBeLessThan(100);
  });
});
