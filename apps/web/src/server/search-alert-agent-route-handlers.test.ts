import { describe, expect, it, vi } from "vitest";

import type {
  ApiResponse,
  JobAlertSchedule,
  RequestSearchAlertResult,
  SavedSearch,
} from "@jobbbler/contracts";
import { DomainError, type ResolvedOwnerSession } from "@jobbbler/core-domain";
import type {
  IdempotencyRecord,
  SearchAlertPreparationRepository,
  SearchAlertPreparationSagaRecord,
} from "@jobbbler/storage";

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
const requestIdempotencyKey = "webmcp-search-alert-request-1";

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

function privateRequest(
  path: string,
  body: unknown,
  cookie = ownerCookie,
  idempotencyKey: string | null = requestIdempotencyKey,
): Request {
  return new Request(`https://jobbbler.example${path}`, {
    method: "POST",
    headers: {
      origin: "https://jobbbler.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      cookie,
      ...(idempotencyKey === null ? {} : { "idempotency-key": idempotencyKey }),
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
      if (existing !== undefined) {
        if (existing.requestHash !== record.requestHash) {
          throw new DomainError({
            code: "CONFLICT",
            message: "The idempotency key is already bound to a different request.",
          });
        }
        return { inserted: false, record: existing };
      }
      records.set(key, record);
      return { inserted: true, record };
    }),
    deleteExact: vi.fn(
      async (input: Pick<IdempotencyRecord, "scope" | "key" | "requestHash" | "responseBody">) => {
        const mapKey = `${input.scope}:${input.key}`;
        const existing = records.get(mapKey);
        if (
          existing?.requestHash !== input.requestHash ||
          JSON.stringify(existing.responseBody) !== JSON.stringify(input.responseBody)
        ) {
          return false;
        }
        records.delete(mapKey);
        return true;
      },
    ),
    purgeExpired: vi.fn(async () => 0),
  };
}

function createDependencies() {
  let now = initialNow;
  let savedVersion = 0;
  let endpointStatus: "pending" | "verified" | "revoked" = "pending";
  let storedSchedule: JobAlertSchedule | null = null;
  let verificationStarted = false;
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
  const startedVerification = {
    challengeId,
    endpointId,
    rawCode: code,
    expiresAt: "2026-08-30T09:10:00.000Z",
    maskedAddress: maskedDestination,
    encryptedAddress: "protected-email-envelope",
  };
  const confirmAlertVerification = vi.fn(async (_ownerId: string, input: unknown) => {
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
  });
  const identityOperations = {
    createEphemeralSession: vi.fn(),
    resolveSession: vi.fn<IdentityRouteDependencies["identity"]["resolveSession"]>(async () => ({
      owner,
      session,
    })),
    startEmailVerification: vi.fn(async () => startedVerification),
    startSearchAlertEmailVerification: vi.fn(async () => {
      verificationStarted = true;
      if (endpointStatus !== "verified") endpointStatus = "pending";
      return startedVerification;
    }),
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
    confirmSearchAlertEmailVerification: confirmAlertVerification,
    abandonSearchAlertEmailVerification: vi.fn(
      async (_ownerId: string, _challengeId: string, _now: string) => {
        if (endpointStatus === "pending") endpointStatus = "revoked";
        return true;
      },
    ),
    listVerificationEndpoints: vi.fn(async () => [endpoint()]),
    revokeVerificationEndpoint: vi.fn(),
    startOwnerRecovery: vi.fn(),
    completeOwnerRecovery: vi.fn(),
    startOwnerDeletion: vi.fn(),
    completeOwnerDeletion: vi.fn(),
  } satisfies IdentityRouteDependencies["identity"];
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
    ensureSavedSearch: vi.fn(async () => savedSearch()),
    createSavedSearch: vi.fn(async () => savedSearch()),
    deleteSavedSearch: vi.fn(async () => ({ savedSearch: savedSearch(), schedule: null })),
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
  const findSaga = (requestId: string): SearchAlertPreparationSagaRecord | null => {
    for (const record of idempotency.records.values()) {
      if (!record.scope.startsWith(`search_alert.request_saga:${ownerId}`)) continue;
      const body = record.responseBody as { requestId?: string };
      if (body.requestId === requestId) {
        return record as SearchAlertPreparationSagaRecord;
      }
    }
    return null;
  };
  const cleanupPreparation = async (
    saga: SearchAlertPreparationSagaRecord,
    cleanupProvisional: boolean,
    cleanupAt: string,
  ) => {
    if (cleanupProvisional) {
      if (verificationStarted) {
        await identityOperations.abandonSearchAlertEmailVerification(
          ownerId,
          saga.responseBody.challengeId,
          cleanupAt,
        );
        verificationStarted = false;
      }
      await service.deleteSavedSearch(ownerId, saga.responseBody.savedSearchId);
    }
    for (const [key, record] of idempotency.records) {
      if (
        record.scope.startsWith("search_alert.") &&
        !record.scope.startsWith(`search_alert.decision:${ownerId}`)
      ) {
        idempotency.records.delete(key);
      }
    }
  };
  const preparation: SearchAlertPreparationRepository = {
    beginApproved: vi.fn(async (input) => {
      const completed = await idempotency.get(
        `search_alert.decision:${input.ownerId}`,
        input.requestId,
      );
      if (completed !== null || findSaga(input.requestId) === null) {
        throw new DomainError({
          code: "CONFLICT",
          message: "The exact search alert preparation is no longer live.",
        });
      }
      return idempotency.putIfAbsent(input.intent);
    }),
    commitApproved: vi.fn(async (input) => {
      const existingDecision = await idempotency.get(
        `search_alert.decision:${input.ownerId}`,
        input.requestId,
      );
      if (existingDecision !== null && storedSchedule !== null) {
        return { inserted: false, schedule: input.schedule, decision: existingDecision };
      }
      const saga = findSaga(input.requestId);
      const intent = await idempotency.get(input.intent.scope, input.intent.key);
      if (
        saga === null ||
        intent === null ||
        intent.requestHash !== input.intent.requestHash ||
        endpointStatus !== "verified" ||
        savedVersion !== input.expectedSavedSearchVersion
      ) {
        throw new DomainError({
          code: "CONFLICT",
          message: "Reviewed alert values changed.",
        });
      }
      storedSchedule ??= {
        id: input.schedule.id,
        ownerId: input.schedule.ownerId,
        savedSearchId: input.schedule.savedSearchId,
        recurrence: input.schedule.recurrence,
        delivery: { channel: "email", endpointId: input.schedule.deliveryEndpointId },
        enabled: true,
        nextRunAt: input.schedule.nextRunAt,
        version: input.schedule.version,
        createdAt: input.schedule.createdAt,
        updatedAt: input.schedule.updatedAt,
      };
      const put = await idempotency.putIfAbsent(input.decision);
      await cleanupPreparation(saga, false, input.now);
      return { inserted: put.inserted, schedule: input.schedule, decision: put.record };
    }),
    decline: vi.fn(async (input) => {
      const existingDecision = await idempotency.get(
        `search_alert.decision:${input.ownerId}`,
        input.requestId,
      );
      if (existingDecision !== null) return { inserted: false, record: existingDecision };
      const saga = findSaga(input.requestId);
      if (saga === null) {
        throw new DomainError({
          code: "CONFLICT",
          message: "The exact search alert preparation is no longer live.",
        });
      }
      await idempotency.putIfAbsent(input.intent);
      const put = await idempotency.putIfAbsent(input.decision);
      await cleanupPreparation(saga, true, input.now);
      return { inserted: put.inserted, record: put.record };
    }),
    expire: vi.fn(async (input) => {
      if (Date.parse(input.reviewExpiresAt) > Date.parse(input.now)) {
        throw new DomainError({ code: "CONFLICT", message: "The review is still live." });
      }
      const saga = findSaga(input.requestId);
      if (saga === null) return false;
      const decision = await idempotency.get(
        `search_alert.decision:${input.ownerId}`,
        input.requestId,
      );
      const intent = await idempotency.get(
        `search_alert.decision_intent:${input.ownerId}`,
        input.requestId,
      );
      if (
        decision !== null ||
        (intent !== null && Date.parse(intent.expiresAt) > Date.parse(input.now))
      ) {
        return false;
      }
      await cleanupPreparation(saga, true, input.now);
      return true;
    }),
    compensate: vi.fn(async (input) => {
      const current = idempotency.records.get(`${input.saga.scope}:${input.saga.key}`);
      if (
        current === undefined ||
        current.requestHash !== input.saga.requestHash ||
        JSON.stringify(current.responseBody) !== JSON.stringify(input.saga.responseBody)
      ) {
        return false;
      }
      const decision = await idempotency.get(
        `search_alert.decision:${input.saga.responseBody.ownerId}`,
        input.saga.responseBody.requestId,
      );
      const intent = await idempotency.get(
        `search_alert.decision_intent:${input.saga.responseBody.ownerId}`,
        input.saga.responseBody.requestId,
      );
      if (
        decision !== null ||
        (intent !== null && Date.parse(intent.expiresAt) > Date.parse(input.now))
      ) {
        return false;
      }
      await cleanupPreparation(input.saga, true, input.now);
      return true;
    }),
    purgeExpired: vi.fn(async () => 0),
  };
  const activity = { publish: vi.fn(async () => true) };
  const dependencies: SearchAlertAgentRouteDependencies = {
    identity,
    savedSearches: service,
    idempotency,
    preparation,
    activity,
    reviewCodec: createSearchAlertReviewCodec(identity.environment),
    prospectiveRunAt: vi.fn(() => firstRunAt),
    ids: {
      request: () => "req_650e8400-e29b-41d4-a716-446655440000",
      savedSearch: () => savedSearchId,
      endpoint: () => endpointId,
      challenge: () => challengeId,
      schedule: () => scheduleId,
      claim: () => "claim_650e8400-e29b-41d4-a716-446655440005",
    },
  };
  return {
    dependencies,
    identityOperations,
    idempotency,
    activity,
    service,
    preparation,
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
  const shared = {
    requestId: review.requestId,
    reviewToken: review.reviewToken,
    decision,
    channel: "agent_client" as const,
  };
  return decision === "approved" ? { ...shared, decision, code } : { ...shared, decision };
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
    expect(current.service.ensureSavedSearch).not.toHaveBeenCalled();
    expect(current.identityOperations.startSearchAlertEmailVerification).not.toHaveBeenCalled();
  });

  it("prepares the exact review, protects the raw destination, delivers the challenge, and creates no schedule", async () => {
    const current = createDependencies();
    const review = await prepare(current);

    expect(current.service.ensureSavedSearch).toHaveBeenCalledWith(
      ownerId,
      savedSearchId,
      { name: requestInput.name, criteria },
      initialNow,
    );
    expect(current.identityOperations.startSearchAlertEmailVerification).toHaveBeenCalledWith(
      ownerId,
      { email },
      initialNow,
      { endpointId, challengeId },
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

  it("requires a valid client Idempotency-Key before request preparation", async () => {
    const current = createDependencies();

    const missing = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput, ownerCookie, null),
      current.dependencies,
    );
    const invalid = await handleRequestSearchAlert(
      privateRequest(
        "/api/v1/agent/search-alerts/request",
        requestInput,
        ownerCookie,
        "invalid key!",
      ),
      current.dependencies,
    );

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(current.service.ensureSavedSearch).not.toHaveBeenCalled();
    expect(current.identityOperations.startSearchAlertEmailVerification).not.toHaveBeenCalled();
  });

  it("replays request preparation for the same client key without replacing the review", async () => {
    const current = createDependencies();

    const first = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );
    const replay = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );

    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(await responseData(replay)).toEqual(await responseData(first));
    expect(current.service.ensureSavedSearch).toHaveBeenCalledOnce();
    expect(current.identityOperations.startSearchAlertEmailVerification).toHaveBeenCalledOnce();
    expect(current.dependencies.identity.delivery.deliverVerification).toHaveBeenCalledOnce();

    const mismatch = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", {
        ...requestInput,
        name: "Different search",
      }),
      current.dependencies,
    );
    expect(mismatch.status).toBe(409);
    expect(current.service.ensureSavedSearch).toHaveBeenCalledOnce();
  });

  it("does not replay a short-lived request result after its review expires", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    current.setNow(review.expiresAt);

    const response = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );

    expect(response.status).toBe(409);
    expect(current.idempotency.deleteExact).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: `search_alert.request_result:${ownerId}`,
        key: requestIdempotencyKey,
      }),
    );
  });

  it("claims a client request key before concurrent preparation side effects", async () => {
    const current = createDependencies();
    let releaseCreate!: () => void;
    const createPaused = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    vi.mocked(current.service.ensureSavedSearch).mockImplementationOnce(async () => {
      await createPaused;
      return {
        id: savedSearchId,
        ownerId,
        name: requestInput.name,
        criteria,
        version: 0,
        createdAt: initialNow,
        updatedAt: initialNow,
      };
    });

    const first = handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );
    await vi.waitFor(() => expect(current.service.ensureSavedSearch).toHaveBeenCalledOnce());
    const concurrent = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );
    releaseCreate();
    const completed = await first;

    expect(completed.status).toBe(202);
    expect(concurrent.status).toBe(409);
    expect(current.service.ensureSavedSearch).toHaveBeenCalledOnce();
    expect(current.identityOperations.startSearchAlertEmailVerification).toHaveBeenCalledOnce();
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
    expect(current.identityOperations.confirmSearchAlertEmailVerification).not.toHaveBeenCalled();
    expect(current.identityOperations.abandonSearchAlertEmailVerification).toHaveBeenCalledWith(
      ownerId,
      challengeId,
      initialNow,
    );
    expect(current.service.deleteSavedSearch).toHaveBeenCalledWith(ownerId, savedSearchId);
    expect([...current.idempotency.records.keys()]).toEqual([
      `search_alert.decision:${ownerId}:${review.requestId}`,
    ]);
    expect(current.service.scheduleAlert).not.toHaveBeenCalled();
  });

  it("replays a durable decline receipt without repeating cleanup mutations", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    const body = decisionBody(review, "declined");
    const first = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", body),
      current.dependencies,
    );
    expect(first.status).toBe(200);
    vi.mocked(current.identityOperations.abandonSearchAlertEmailVerification).mockClear();
    vi.mocked(current.service.deleteSavedSearch).mockClear();

    const replay = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", body),
      current.dependencies,
    );

    expect(replay.status).toBe(200);
    expect(await responseData(replay)).toEqual(await responseData(first));
    expect(current.identityOperations.abandonSearchAlertEmailVerification).not.toHaveBeenCalled();
    expect(current.service.deleteSavedSearch).not.toHaveBeenCalled();
  });

  it("consumes the exact review challenge even when another review already verified the endpoint", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    current.setEndpointStatus("verified");

    const response = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(response.status).toBe(201);
    expect(current.identityOperations.confirmSearchAlertEmailVerification).toHaveBeenCalledWith(
      ownerId,
      { challengeId, code },
      initialNow,
    );
    expect(current.identityOperations.completeEmailVerification).not.toHaveBeenCalled();
  });

  it("cleans up the review-scoped challenge when a signed decision arrives at expiry", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    const offsetExpiry = "2026-08-30T05:10:00.000-04:00";
    current.setNow(offsetExpiry);

    const response = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { details: { reason: "expired_review" } },
    });
    expect(current.identityOperations.abandonSearchAlertEmailVerification).toHaveBeenCalledWith(
      ownerId,
      challengeId,
      offsetExpiry,
    );
    expect(current.service.deleteSavedSearch).toHaveBeenCalledWith(ownerId, savedSearchId);
    expect(current.idempotency.records.size).toBe(0);
    expect(current.service.scheduleAlert).not.toHaveBeenCalled();
  });

  it("cleans an expired signed review even when its short request evidence was already purged", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    current.idempotency.records.delete(`search_alert.request:${ownerId}:${review.requestId}`);
    current.setNow(review.expiresAt);

    const response = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(response.status).toBe(401);
    expect(current.service.deleteSavedSearch).toHaveBeenCalledWith(ownerId, savedSearchId);
    expect(current.idempotency.records.size).toBe(0);
  });

  it("does not let approval schedule after a concurrent durable decline", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    current.setEndpointStatus("verified");
    let releaseApproval!: () => void;
    const approvalPaused = new Promise<void>((resolve) => {
      releaseApproval = resolve;
    });
    let listCalls = 0;
    vi.mocked(current.service.listSavedSearches).mockImplementation(async () => {
      listCalls += 1;
      if (listCalls === 1) await approvalPaused;
      return [
        {
          id: savedSearchId,
          ownerId,
          name: requestInput.name,
          criteria,
          version: 0,
          createdAt: initialNow,
          updatedAt: initialNow,
        },
      ];
    });

    const approval = handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );
    await vi.waitFor(() => expect(current.service.listSavedSearches).toHaveBeenCalledOnce());
    const decline = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review, "declined")),
      current.dependencies,
    );
    releaseApproval();
    const approvalResponse = await approval;

    expect(decline.status).toBe(200);
    expect(approvalResponse.status).toBe(409);
    expect(await approvalResponse.json()).toMatchObject({
      ok: false,
      error: { details: { reason: "already_decided" } },
    });
    expect(current.identityOperations.confirmSearchAlertEmailVerification).not.toHaveBeenCalled();
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
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { details: { reason: "invalid_code" } },
    });
    expect(current.service.scheduleAlert).not.toHaveBeenCalled();
  });

  it("rejects a fresh approval when the reviewed first run crossed its recurrence boundary", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    vi.mocked(current.dependencies.prospectiveRunAt).mockReturnValueOnce(
      "2026-09-01T06:00:48.000Z",
    );

    const response = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { details: { reason: "stale_review" } },
    });
    expect(current.identityOperations.confirmSearchAlertEmailVerification).not.toHaveBeenCalled();
    expect(current.preparation.commitApproved).not.toHaveBeenCalled();
  });

  it("replays an exact durable receipt after review and request-saga expiry cleanup", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    const first = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );
    expect(first.status).toBe(201);
    for (const key of [...current.idempotency.records.keys()]) {
      if (!key.startsWith(`search_alert.decision:${ownerId}:`)) {
        current.idempotency.records.delete(key);
      }
    }
    current.setNow("2026-08-30T09:20:00.000Z");

    const replay = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(replay.status).toBe(200);
    expect(await responseData(replay)).toEqual(await responseData(first));
    expect(current.preparation.commitApproved).toHaveBeenCalledOnce();
  });

  it("retains redacted review-bound consent evidence in the long-lived receipt", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    const response = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );
    expect(response.status).toBe(201);

    const durable = current.idempotency.records.get(
      `search_alert.decision:${ownerId}:${review.requestId}`,
    );
    expect(durable?.responseBody).toMatchObject({
      status: "completed",
      evidence: {
        purpose: "Store this search and email matching-job updates.",
        dataCategories: ["saved_search_criteria", "delivery_email"],
        criteria,
        savedSearchId,
        savedSearchVersion: 0,
        endpointId,
        recurrence,
        firstRunAt,
        privacyNoticeVersion: "search-alert-v1",
        channel: "agent_client",
      },
    });
    const serialized = JSON.stringify(durable);
    expect(serialized).not.toContain(review.reviewToken);
    expect(serialized).not.toContain(challengeId);
    expect(serialized).not.toContain(code);
    expect(serialized).not.toContain(email);
  });

  it("rejects tampered, expired, request-mismatched, and owner-mismatched reviews", async () => {
    const tampered = createDependencies();
    const tamperedReview = await prepare(tampered);
    const [tamperedPayload, tamperedSignature] = tamperedReview.reviewToken.split(".") as [
      string,
      string,
    ];
    const tamperedResponse = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", {
        ...decisionBody(tamperedReview),
        reviewToken: `${tamperedPayload}.${tamperedSignature.startsWith("A") ? "B" : "A"}${tamperedSignature.slice(1)}`,
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
        requestId: "req_750e8400-e29b-41d4-a716-446655440000",
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
    expect(current.identityOperations.confirmSearchAlertEmailVerification).not.toHaveBeenCalled();
    expect(current.service.scheduleAlert).not.toHaveBeenCalled();
  });

  it("accepts an exact reviewed search after JSON persistence reorders criteria keys", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    const reorderedCriteria = Object.fromEntries(
      Object.entries(criteria).reverse(),
    ) as unknown as typeof criteria;
    vi.mocked(current.service.listSavedSearches).mockResolvedValueOnce([
      {
        id: savedSearchId,
        ownerId,
        name: requestInput.name,
        criteria: reorderedCriteria,
        version: 0,
        createdAt: initialNow,
        updatedAt: initialNow,
      },
    ]);

    const response = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(response.status).toBe(201);
    expect(current.identityOperations.confirmSearchAlertEmailVerification).toHaveBeenCalledOnce();
  });

  it("verifies the bound challenge and activates only the signed schedule values", async () => {
    const current = createDependencies();
    const review = await prepare(current);

    const response = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(response.status).toBe(201);
    expect(current.identityOperations.confirmSearchAlertEmailVerification).toHaveBeenCalledWith(
      ownerId,
      { challengeId, code },
      initialNow,
    );
    expect(current.preparation.commitApproved).toHaveBeenCalledWith({
      ownerId,
      requestId: review.requestId,
      reviewEvidenceHash: expect.any(String),
      intent: expect.objectContaining({
        scope: `search_alert.decision_intent:${ownerId}`,
        key: review.requestId,
      }),
      now: initialNow,
      schedule: {
        id: scheduleId,
        ownerId,
        savedSearchId,
        recurrence,
        deliveryChannel: "email",
        deliveryEndpointId: endpointId,
        enabled: true,
        nextRunAt: firstRunAt,
        version: 0,
        createdAt: initialNow,
        updatedAt: initialNow,
      },
      expectedSavedSearchVersion: 0,
      verifiedEndpointId: endpointId,
      decision: expect.objectContaining({
        scope: `search_alert.decision:${ownerId}`,
        key: review.requestId,
        responseStatus: 201,
      }),
    });
    expect([...current.idempotency.records.keys()]).toEqual([
      `search_alert.decision:${ownerId}:${review.requestId}`,
    ]);
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
    expect(current.identityOperations.confirmSearchAlertEmailVerification).toHaveBeenCalledOnce();
    expect(current.preparation.commitApproved).toHaveBeenCalledOnce();
    expect(current.activity.publish).toHaveBeenCalledTimes(2);
  });

  it("retries atomic activation safely after verification succeeded but storage failed", async () => {
    const current = createDependencies();
    const review = await prepare(current);
    vi.mocked(current.preparation.commitApproved).mockRejectedValueOnce(
      new DomainError({
        code: "DEPENDENCY",
        message: "Atomic alert storage is unavailable.",
        retryable: true,
      }),
    );

    const first = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );
    expect(
      current.idempotency.records.get(`search_alert.decision_intent:${ownerId}:${review.requestId}`)
        ?.expiresAt,
    ).toBe("2026-08-31T09:00:00.000Z");
    current.setNow(review.expiresAt);
    const second = await handleDecideSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/decision", decisionBody(review)),
      current.dependencies,
    );

    expect(first.status).toBe(502);
    expect(second.status).toBe(201);
    expect(current.identityOperations.confirmSearchAlertEmailVerification).toHaveBeenCalledTimes(2);
    expect(current.preparation.commitApproved).toHaveBeenCalledTimes(2);
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

  it("compensates a definitive delivery rejection before preparing a review", async () => {
    const current = createDependencies();
    current.dependencies.identity.delivery.deliverVerification = vi.fn(async () => {
      throw new DomainError({
        code: "DEPENDENCY",
        message: "Verification delivery is unavailable.",
        retryable: false,
      });
    });

    const response = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );

    expect(response.status).toBe(502);
    expect(current.idempotency.records.size).toBe(0);
    expect(current.identityOperations.abandonSearchAlertEmailVerification).toHaveBeenCalledWith(
      ownerId,
      challengeId,
      initialNow,
    );
    expect(current.service.deleteSavedSearch).toHaveBeenCalledWith(ownerId, savedSearchId);
    expect(current.activity.publish).not.toHaveBeenCalled();
    expect(current.service.scheduleAlert).not.toHaveBeenCalled();

    current.dependencies.identity.delivery.deliverVerification = vi.fn(async () => ({
      delivery: "queued" as const,
    }));
    const retry = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );
    expect(retry.status).toBe(202);
    expect(current.service.ensureSavedSearch).toHaveBeenCalledTimes(2);
  });

  it("resumes the same challenge and provider request after accepted-then-timeout delivery", async () => {
    const current = createDependencies();
    const deliveries: unknown[] = [];
    current.dependencies.identity.delivery.deliverVerification = vi
      .fn()
      .mockImplementationOnce(async (input) => {
        deliveries.push(structuredClone(input));
        throw new DomainError({
          code: "DEPENDENCY",
          message: "The provider accepted the request but its response was lost.",
          retryable: true,
        });
      })
      .mockImplementationOnce(async (input) => {
        deliveries.push(structuredClone(input));
        return { delivery: "queued" as const };
      });

    const first = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );
    const retry = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );

    expect(first.status).toBe(502);
    expect(retry.status).toBe(202);
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]).toEqual(deliveries[0]);
    expect(current.service.ensureSavedSearch).toHaveBeenCalledTimes(2);
    expect(current.identityOperations.startSearchAlertEmailVerification).toHaveBeenCalledTimes(2);
    expect(current.identityOperations.abandonSearchAlertEmailVerification).not.toHaveBeenCalled();
    expect(current.service.deleteSavedSearch).not.toHaveBeenCalled();
    const durableBodies = JSON.stringify([...current.idempotency.records.values()]);
    expect(durableBodies).not.toContain(code);
    expect(durableBodies).not.toContain(email);
    expect(durableBodies).not.toContain("protected-email-envelope");
  });

  it("keeps the same saga identifiers after an ambiguous saved-search write", async () => {
    const current = createDependencies();
    vi.mocked(current.service.ensureSavedSearch).mockRejectedValueOnce(
      new DomainError({
        code: "DEPENDENCY",
        message: "The saved search may have been stored before the response was lost.",
        retryable: true,
      }),
    );

    const first = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );
    expect(first.status).toBe(502);
    expect(
      current.idempotency.records.get(
        `search_alert.request_saga:${ownerId}:${requestIdempotencyKey}`,
      ),
    ).toMatchObject({
      responseBody: { savedSearchId, challengeId, scheduleId },
    });
    expect(current.service.deleteSavedSearch).not.toHaveBeenCalled();

    const retry = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );
    expect(retry.status).toBe(202);
    expect(current.service.ensureSavedSearch).toHaveBeenCalledTimes(2);
    expect(current.service.ensureSavedSearch).toHaveBeenNthCalledWith(
      1,
      ownerId,
      savedSearchId,
      { name: requestInput.name, criteria },
      initialNow,
    );
    expect(current.service.ensureSavedSearch).toHaveBeenNthCalledWith(
      2,
      ownerId,
      savedSearchId,
      { name: requestInput.name, criteria },
      initialNow,
    );
  });

  it("keeps the same saga identifiers after an ambiguous challenge write", async () => {
    const current = createDependencies();
    vi.mocked(current.identityOperations.startSearchAlertEmailVerification).mockRejectedValueOnce(
      new DomainError({
        code: "DEPENDENCY",
        message: "The challenge may have been stored before the response was lost.",
        retryable: true,
      }),
    );

    const first = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );
    expect(first.status).toBe(502);
    expect(
      current.idempotency.records.get(
        `search_alert.request_saga:${ownerId}:${requestIdempotencyKey}`,
      ),
    ).toMatchObject({ responseBody: { savedSearchId, endpointId, challengeId } });
    expect(current.service.deleteSavedSearch).not.toHaveBeenCalled();

    const retry = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );
    expect(retry.status).toBe(202);
    expect(current.identityOperations.startSearchAlertEmailVerification).toHaveBeenNthCalledWith(
      1,
      ownerId,
      { email },
      initialNow,
      { endpointId, challengeId },
    );
    expect(current.identityOperations.startSearchAlertEmailVerification).toHaveBeenNthCalledWith(
      2,
      ownerId,
      { email },
      initialNow,
      { endpointId, challengeId },
    );
  });

  it("removes the saved search and releases the client claim when verification setup fails", async () => {
    const current = createDependencies();
    current.identityOperations.startSearchAlertEmailVerification = vi.fn(async () => {
      throw new DomainError({
        code: "DEPENDENCY",
        message: "Verification storage is unavailable.",
        retryable: false,
      });
    });

    const response = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );

    expect(response.status).toBe(502);
    expect(current.service.deleteSavedSearch).toHaveBeenCalledWith(ownerId, savedSearchId);
    expect(current.identityOperations.abandonSearchAlertEmailVerification).not.toHaveBeenCalled();
    expect(current.idempotency.records.size).toBe(0);
  });

  it("rejects a revoked shared destination before delivery and compensates preparation", async () => {
    const current = createDependencies();
    current.identityOperations.startSearchAlertEmailVerification = vi.fn(async () => {
      throw new DomainError({
        code: "CONFLICT",
        message: "This delivery address is revoked and cannot be used for search alerts.",
      });
    });

    const response = await handleRequestSearchAlert(
      privateRequest("/api/v1/agent/search-alerts/request", requestInput),
      current.dependencies,
    );

    expect(response.status).toBe(409);
    expect(current.dependencies.identity.delivery.deliverVerification).not.toHaveBeenCalled();
    expect(current.service.deleteSavedSearch).toHaveBeenCalledWith(ownerId, savedSearchId);
    expect(current.idempotency.records.size).toBe(0);
  });
});
