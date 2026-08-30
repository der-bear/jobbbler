import { describe, expect, it, vi } from "vitest";

import type {
  ApiResponse,
  JobAlertSchedule,
  RequestSearchAlertResult,
  SavedSearch,
} from "@jobbbler/contracts";
import { DomainError, type ResolvedOwnerSession } from "@jobbbler/core-domain";
import type { IdempotencyRecord } from "@jobbbler/storage";

import type { IdentityRouteDependencies } from "./identity-route-handlers";
import {
  handleDecideSearchAlert,
  handleRequestSearchAlert,
  type SearchAlertAgentRouteDependencies,
} from "./search-alert-agent-route-handlers";
import { createSearchAlertReviewCodec } from "./search-alert-review-token";

const initialNow = "2026-08-30T09:00:00.000Z";
const ownerId = "owner_550e8400-e29b-41d4-a716-446655440000";
const savedSearchId = "saved_550e8400-e29b-41d4-a716-446655440001";
const endpointId = "endpoint_550e8400-e29b-41d4-a716-446655440002";
const challengeId = "challenge_550e8400-e29b-41d4-a716-446655440003";
const scheduleId = "schedule_550e8400-e29b-41d4-a716-446655440004";
const ownerCookie = "jobbbler_owner=owner-session-token-with-at-least-thirty-two-characters";
const code = "372941";
const email = "person@example.com";
const maskedDestination = "p•••••@example.com";
const firstRunAt = "2026-08-31T06:00:48.000Z";

const criteria = {
  query: "TypeScript",
  categories: ["software_engineering" as const],
  workModels: ["remote" as const],
  seniorities: ["senior" as const],
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
const recurrence = {
  frequency: "daily" as const,
  time: "09:00",
  timeZone: "Europe/Kyiv",
};
const requestInput = {
  name: "Remote TypeScript",
  criteria,
  recurrence,
  delivery: { channel: "email" as const, email },
};

function privateRequest(path: string, body: unknown, cookie = ownerCookie): Request {
  return new Request(`https://jobbbler.example${path}`, {
    method: "POST",
    headers: {
      origin: "https://jobbbler.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
}

function inMemoryIdempotency() {
  const records = new Map<string, IdempotencyRecord>();
  return {
    records,
    get: vi.fn(async (scope: string, key: string) => records.get(`${scope}:${key}`) ?? null),
    putIfAbsent: vi.fn(async (record: IdempotencyRecord) => {
      const key = `${record.scope}:${record.key}`;
      const existing = records.get(key);
      if (existing !== undefined) return { inserted: false, record: existing };
      records.set(key, record);
      return { inserted: true, record };
    }),
  };
}

function createDependencies() {
  let now = initialNow;
  let savedVersion = 0;
  let endpointStatus: "pending" | "verified" | "revoked" = "pending";
  let storedSchedule: JobAlertSchedule | null = null;
  const owner = {
    id: ownerId,
    kind: "ephemeral" as const,
    verified: false,
    version: 0,
    createdAt: initialNow,
    updatedAt: initialNow,
  };
  const session = {
    id: "session_550e8400-e29b-41d4-a716-446655440005",
    ownerId,
    tokenHash: "stored-hash",
    status: "active" as const,
    expiresAt: "2026-09-06T09:00:00.000Z",
    lastSeenAt: initialNow,
    createdAt: initialNow,
    updatedAt: initialNow,
  };
  const savedSearch = (): SavedSearch => ({
    id: savedSearchId,
    ownerId,
    name: requestInput.name,
    criteria,
    version: savedVersion,
    createdAt: initialNow,
    updatedAt: initialNow,
  });
  const endpoint = () => ({
    id: endpointId,
    kind: "email" as const,
    maskedAddress: maskedDestination,
    status: endpointStatus,
    verifiedAt: endpointStatus === "verified" ? now : null,
  });
  const identityOperations: IdentityRouteDependencies["identity"] = {
    createEphemeralSession: vi.fn(),
    resolveSession: vi.fn(async () => ({ owner, session })),
    startEmailVerification: vi.fn(async () => ({
      challengeId,
      endpointId,
      rawCode: code,
      expiresAt: "2026-08-30T09:10:00.000Z",
      maskedAddress: maskedDestination,
      encryptedAddress: "protected-email-envelope",
    })),
    completeEmailVerification: vi.fn(async (_ownerId, input: unknown) => {
      const submitted = input as { challengeId?: string; code?: string };
      if (submitted.challengeId !== challengeId || submitted.code !== code) {
        throw new DomainError({
          code: "UNAUTHORIZED",
          message: "The verification code is invalid.",
        });
      }
      endpointStatus = "verified";
      return {
        owner: { id: ownerId, kind: "guest" as const, verified: true, recoverable: true },
        endpointId,
        verifiedAt: now,
      };
    }),
    listVerificationEndpoints: vi.fn(async () => [endpoint()]),
    revokeVerificationEndpoint: vi.fn(),
    startOwnerRecovery: vi.fn(),
    completeOwnerRecovery: vi.fn(),
    startOwnerDeletion: vi.fn(),
    completeOwnerDeletion: vi.fn(),
  };
  const identity: IdentityRouteDependencies = {
    identity: identityOperations,
    delivery: {
      deliverVerification: vi.fn(async () => ({ delivery: "queued" as const })),
    },
    environment: {
      NODE_ENV: "test",
      PUBLIC_BASE_URL: "https://jobbbler.example",
      TOKEN_HASH_SECRET: "search-alert-handler-test-secret-at-least-32-characters",
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
  const service: SearchAlertAgentRouteDependencies["savedSearches"] = {
    createSavedSearch: vi.fn(async () => savedSearch()),
    listSavedSearches: vi.fn(async () => [savedSearch()]),
    scheduleAlert: vi.fn(async (_ownerId, rawInput: unknown) => {
      if (storedSchedule !== null) return storedSchedule;
      const input = rawInput as {
        savedSearchId: string;
        expectedVersion: number;
        recurrence: typeof recurrence;
        delivery: { endpointId: string };
      };
      if (
        input.savedSearchId !== savedSearchId ||
        input.expectedVersion !== savedVersion ||
        JSON.stringify(input.recurrence) !== JSON.stringify(recurrence) ||
        input.delivery.endpointId !== endpointId ||
        endpointStatus !== "verified"
      ) {
        throw new DomainError({ code: "CONFLICT", message: "Reviewed alert values changed." });
      }
      storedSchedule = {
        id: scheduleId,
        ownerId,
        savedSearchId,
        recurrence,
        delivery: { channel: "email", endpointId },
        enabled: true,
        nextRunAt: firstRunAt,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      return storedSchedule;
    }),
  };
  const idempotency = inMemoryIdempotency();
  const activity = { publish: vi.fn(async () => true) };
  const dependencies: SearchAlertAgentRouteDependencies = {
    identity,
    savedSearches: service,
    idempotency,
    activity,
    reviewCodec: createSearchAlertReviewCodec(identity.environment),
    prospectiveRunAt: vi.fn(() => firstRunAt),
  };
  return {
    dependencies,
    identityOperations,
    idempotency,
    activity,
    service,
    setNow(value: string) {
      now = value;
    },
    setSavedVersion(value: number) {
      savedVersion = value;
    },
    setEndpointStatus(value: typeof endpointStatus) {
      endpointStatus = value;
    },
  };
}

async function responseData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiResponse<T>;
  if (!body.ok) throw new Error(`Expected success but received ${body.error.code}.`);
  return body.data;
}

async function prepare(current: ReturnType<typeof createDependencies>) {
  const response = await handleRequestSearchAlert(
    privateRequest("/api/v1/agent/search-alerts/request", requestInput),
    current.dependencies,
  );
  expect(response.status).toBe(202);
  return responseData<RequestSearchAlertResult>(response);
}

function decisionBody(
  review: RequestSearchAlertResult,
  decision: "approved" | "declined" = "approved",
) {
  return {
    requestId: review.requestId,
    reviewToken: review.reviewToken,
    code,
    decision,
    channel: "agent_client" as const,
  };
}

describe("agent-native search alert route handlers", () => {
  it("requires a same-origin private owner session before creating anything", async () => {
    const current = createDependencies();
    current.identityOperations.resolveSession = vi.fn(async () => null);

    const response = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );

    expect(response.status).toBe(401);
    expect(current.service.createSavedSearch).not.toHaveBeenCalled();
    expect(current.identityOperations.startEmailVerification).not.toHaveBeenCalled();
  });

  it("prepares the exact review, protects the raw destination, delivers the challenge, and creates no schedule", async () => {
    const current = createDependencies();
    const review = await prepare(current);

    expect(current.service.createSavedSearch).toHaveBeenCalledWith(
      ownerId,
      { name: requestInput.name, criteria },
      initialNow,
    );
    expect(current.identityOperations.startEmailVerification).toHaveBeenCalledWith(
      ownerId,
      { email },
      initialNow,
    );
    expect(current.dependencies.identity.delivery.deliverVerification).toHaveBeenCalledWith({
      encryptedAddress: "protected-email-envelope",
      code,
      expiresAt: "2026-08-30T09:10:00.000Z",
      challengeId,
    });
    expect(review).toMatchObject({
      status: "requires_user_action",
      expiresAt: "2026-08-30T09:10:00.000Z",
      review: {
        savedSearchId,
        savedSearchVersion: 0,
        maskedDestination,
        criteria,
        recurrence,
        firstRunAt,
        dataCategories: ["saved_search_criteria", "delivery_email"],
      },
    });
    expect(current.service.scheduleAlert).not.toHaveBeenCalled();
    const serialized = JSON.stringify(review);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(code);
    expect(serialized).not.toContain("protected-email-envelope");
  });

  it("records a decline without consuming the challenge or creating a schedule", async () => {
    const current = createDependencies();
    const review = await prepare(current);

    const response = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review, "declined")),
      current.dependencies,
    );

    expect(response.status).toBe(200);
    await expect(responseData(response)).resolves.toMatchObject({
      decision: "declined",
      scheduleId: null,
      nextRunAt: null,
    });
    expect(current.identityOperations.completeEmailVerification).not.toHaveBeenCalled();
    expect(current.service.scheduleAlert).not.toHaveBeenCalled();
  });

  it("fails closed for a wrong mailbox code", async () => {
    const current = createDependencies();
    const review = await prepare(current);

    const response = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", {
        ...decisionBody(review),
        code: "000000",
      }),
      current.dependencies,
    );

    expect(response.status).toBe(401);
    expect(current.service.scheduleAlert).not.toHaveBeenCalled();
  });

  it("rejects tampered, expired, request-mismatched, and owner-mismatched reviews", async () => {
    const tampered = createDependencies();
    const tamperedReview = await prepare(tampered);
    const tamperedResponse = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", {
        ...decisionBody(tamperedReview),
        reviewToken: `${tamperedReview.reviewToken.slice(0, -1)}A`,
      }),
      tampered.dependencies,
    );
    expect(tamperedResponse.status).toBe(401);

    const expired = createDependencies();
    const expiredReview = await prepare(expired);
    expired.setNow(expiredReview.expiresAt);
    const expiredResponse = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(expiredReview)),
      expired.dependencies,
    );
    expect(expiredResponse.status).toBe(401);

    const mismatchedRequest = createDependencies();
    const requestReview = await prepare(mismatchedRequest);
    const requestResponse = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", {
        ...decisionBody(requestReview),
        requestId: "req_650e8400-e29b-41d4-a716-446655440000",
      }),
      mismatchedRequest.dependencies,
    );
    expect(requestResponse.status).toBe(401);

    const mismatchedOwner = createDependencies();
    const ownerReview = await prepare(mismatchedOwner);
    mismatchedOwner.identityOperations.resolveSession = vi.fn(
      async (rawToken: string | null, resolvedAt: string): Promise<ResolvedOwnerSession> => ({
        owner: {
          id: "owner_650e8400-e29b-41d4-a716-446655440000",
          kind: "ephemeral",
          verified: false,
          version: 0,
          createdAt: initialNow,
          updatedAt: initialNow,
        },
        session: {
          id: "session_650e8400-e29b-41d4-a716-446655440001",
          ownerId: "owner_650e8400-e29b-41d4-a716-446655440000",
          tokenHash: rawToken ?? "missing",
          status: "active",
          expiresAt: "2026-09-06T09:00:00.000Z",
          lastSeenAt: resolvedAt,
          createdAt: initialNow,
          updatedAt: initialNow,
        },
      }),
    );
    const ownerResponse = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(ownerReview)),
      mismatchedOwner.dependencies,
    );
    expect(ownerResponse.status).toBe(401);
  });

  it("rejects a saved search that changed after the exact review", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    current.setSavedVersion(1);

    const response = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(response.status).toBe(409);
    expect(current.identityOperations.completeEmailVerification).not.toHaveBeenCalled();
    expect(current.service.scheduleAlert).not.toHaveBeenCalled();
  });

  it("verifies the bound challenge and activates only the signed schedule values", async () => {
    const current = createDependencies();
    const review = await prepare(current);

    const response = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(response.status).toBe(201);
    expect(current.identityOperations.completeEmailVerification).toHaveBeenCalledWith(
      ownerId,
      { challengeId, code },
      initialNow,
    );
    expect(current.service.scheduleAlert).toHaveBeenCalledWith(
      ownerId,
      {
        savedSearchId,
        expectedVersion: 0,
        recurrence,
        delivery: { channel: "email", endpointId },
      },
      initialNow,
    );
    await expect(responseData(response)).resolves.toMatchObject({
      status: "completed",
      requestId: review.requestId,
      decision: "approved",
      channel: "agent_client",
      savedSearchId,
      scheduleId,
      nextRunAt: firstRunAt,
    });
  });

  it("returns the identical approved receipt on retry without repeating authoritative work", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    const body = decisionBody(review);
    const first = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", body),
      current.dependencies,
    );
    const firstBody = (await first.json()) as ApiResponse<unknown>;
    const second = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", body),
      current.dependencies,
    );

    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as ApiResponse<unknown>;
    expect(secondBody.ok && firstBody.ok ? secondBody.data : null).toEqual(
      firstBody.ok ? firstBody.data : null,
    );
    expect(current.identityOperations.completeEmailVerification).toHaveBeenCalledOnce();
    expect(current.service.scheduleAlert).toHaveBeenCalledOnce();
    expect(current.activity.publish).toHaveBeenCalledTimes(2);
  });

  it("retries scheduling safely after verification succeeded but schedule storage failed", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    vi.mocked(current.service.scheduleAlert)
      .mockRejectedValueOnce(
        new DomainError({
          code: "DEPENDENCY",
          message: "Schedule storage is unavailable.",
          retryable: true,
        }),
      )
      .mockImplementationOnce(async (_ownerId, input) => ({
        id: scheduleId,
        ownerId,
        savedSearchId,
        recurrence: (input as { recurrence: typeof recurrence }).recurrence,
        delivery: { channel: "email", endpointId },
        enabled: true,
        nextRunAt: firstRunAt,
        version: 0,
        createdAt: initialNow,
        updatedAt: initialNow,
      }));

    const first = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );
    const second = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(first.status).toBe(502);
    expect(second.status).toBe(201);
    expect(current.identityOperations.completeEmailVerification).toHaveBeenCalledOnce();
    expect(current.service.scheduleAlert).toHaveBeenCalledTimes(2);
  });

  it("publishes only redacted agent activity after the durable request and decision transitions", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(current.activity.publish).toHaveBeenCalledTimes(2);
    expect(current.activity.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ownerId,
        key: "request_search_alert",
        status: "requires_user_action",
        actorKind: "agent",
      }),
    );
    expect(current.activity.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ownerId,
        key: "decide_search_alert",
        status: "completed",
        actorKind: "agent",
      }),
    );
    const activity = JSON.stringify(vi.mocked(current.activity.publish).mock.calls);
    expect(activity).not.toContain(email);
    expect(activity).not.toContain(code);
    expect(activity).not.toContain(review.reviewToken);
    expect(activity).not.toContain(challengeId);
    expect(activity).not.toContain(endpointId);
  });

  it("does not persist a review when challenge delivery fails", async () => {
    const current = createDependencies();
    current.dependencies.identity.delivery.deliverVerification = vi.fn(async () => {
      throw new DomainError({
        code: "DEPENDENCY",
        message: "Verification delivery is unavailable.",
        retryable: true,
      });
    });

    const response = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );

    expect(response.status).toBe(502);
    expect(current.idempotency.records.size).toBe(0);
    expect(current.activity.publish).not.toHaveBeenCalled();
    expect(current.service.scheduleAlert).not.toHaveBeenCalled();
  });
});
