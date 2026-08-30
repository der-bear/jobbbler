import { isDeepStrictEqual } from "node:util";

import {
  decideSearchAlertInputSchema,
  decideSearchAlertResultSchema,
  requestSearchAlertInputSchema,
  requestSearchAlertResultSchema,
  type JobAlertSchedule,
  type SavedSearch,
  type ScheduleRecurrence,
} from "@jobbbler/contracts";
import {
  DomainError,
  isDomainError,
  type PreparedSearchAlertEmailVerification,
} from "@jobbbler/core-domain";
import type {
  IdempotencyRecord,
  IdempotencyRecordIdentity,
  IdempotencyRepository,
  ScheduleRecord,
  SearchAlertPreparationRepository,
  SearchAlertPreparationSagaRecord,
} from "@jobbbler/storage";

import { searchAlertReviewPolicy } from "@/lib/search-alert-review-policy";

import { apiErrorResponse, apiSuccessResponse } from "./api-response";
import { readBoundedJsonBody } from "./bounded-json-body";
import { createRequestId, getRateLimitKey } from "./context";
import type { IdentityRouteDependencies } from "./identity-route-handlers";
import { requireOwnerSession } from "./identity-route-handlers";
import { assertTrustedMutationOrigin, sensitiveRateLimitKey } from "./identity-security";
import type { OwnerActivityPublisher } from "./owner-activity-publisher";
import {
  createSearchAlertRequestBinding,
  createSearchAlertReviewBinding,
  searchAlertDecisionEnvelopeSchema,
  searchAlertDecisionIntentSchema,
  searchAlertRequestSagaSchema,
  type SearchAlertDecisionEnvelope,
  type SearchAlertDecisionIntent,
  type SearchAlertRequestSaga,
} from "./search-alert-saga";
import {
  searchAlertReviewPayloadSchema,
  type SearchAlertReviewPayload,
  type createSearchAlertReviewCodec,
} from "./search-alert-review-token";

const MAX_REQUEST_BODY_BYTES = 16_384;
const REVIEW_LIFETIME_MS = 15 * 60 * 1_000;
const DECISION_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;
const DECISION_INTENT_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const REQUEST_CLAIM_LIFETIME_MS = 5 * 60 * 1_000;
const REQUEST_SCOPE_PREFIX = "search_alert.request";
const REQUEST_CLAIM_SCOPE_PREFIX = "search_alert.request_claim";
const REQUEST_SAGA_SCOPE_PREFIX = "search_alert.request_saga";
const REQUEST_RESULT_SCOPE_PREFIX = "search_alert.request_result";
const DECISION_SCOPE_PREFIX = "search_alert.decision";
const DECISION_INTENT_SCOPE_PREFIX = "search_alert.decision_intent";
const DECISION_CLAIM_SCOPE_PREFIX = "search_alert.decision_claim";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

const reviewCopy = {
  purpose: searchAlertReviewPolicy.purpose,
  dataCategories: searchAlertReviewPolicy.dataCategories,
  retention: searchAlertReviewPolicy.retention,
  withdrawal: searchAlertReviewPolicy.withdrawal,
} as const;

export interface SearchAlertAgentRouteDependencies {
  readonly identity: IdentityRouteDependencies;
  readonly savedSearches: {
    ensureSavedSearch(
      ownerId: string,
      savedSearchId: string,
      input: unknown,
      createdAt: string,
    ): Promise<SavedSearch>;
    createSavedSearch(ownerId: string, input: unknown, now: string): Promise<SavedSearch>;
    deleteSavedSearch(
      ownerId: string,
      savedSearchId: string,
    ): Promise<{ readonly savedSearch: SavedSearch; readonly schedule: JobAlertSchedule | null }>;
    listSavedSearches(ownerId: string): Promise<SavedSearch[]>;
    scheduleAlert(ownerId: string, input: unknown, now: string): Promise<JobAlertSchedule>;
  };
  readonly idempotency: Pick<IdempotencyRepository, "deleteExact" | "get" | "putIfAbsent">;
  readonly preparation: SearchAlertPreparationRepository;
  readonly activity?: OwnerActivityPublisher;
  readonly reviewCodec: ReturnType<typeof createSearchAlertReviewCodec>;
  readonly prospectiveRunAt: (
    savedSearchId: string,
    recurrence: ScheduleRecurrence,
    now: string,
  ) => string;
  readonly ids: {
    request(): string;
    savedSearch(): string;
    endpoint(): string;
    challenge(): string;
    schedule(): string;
    claim(): string;
  };
}

function requestScope(ownerId: string): string {
  return `${REQUEST_SCOPE_PREFIX}:${ownerId}`;
}

function requestClaimScope(ownerId: string): string {
  return `${REQUEST_CLAIM_SCOPE_PREFIX}:${ownerId}`;
}

function requestSagaScope(ownerId: string): string {
  return `${REQUEST_SAGA_SCOPE_PREFIX}:${ownerId}`;
}

function requestResultScope(ownerId: string): string {
  return `${REQUEST_RESULT_SCOPE_PREFIX}:${ownerId}`;
}

function decisionScope(ownerId: string): string {
  return `${DECISION_SCOPE_PREFIX}:${ownerId}`;
}

function decisionIntentScope(ownerId: string): string {
  return `${DECISION_INTENT_SCOPE_PREFIX}:${ownerId}`;
}

function decisionClaimScope(ownerId: string): string {
  return `${DECISION_CLAIM_SCOPE_PREFIX}:${ownerId}`;
}

function expiresWithin(reviewBoundary: string, now: string): string {
  const boundaryMs = Date.parse(reviewBoundary);
  const maximumMs = Date.parse(now) + REVIEW_LIFETIME_MS;
  if (
    !Number.isFinite(boundaryMs) ||
    !Number.isFinite(maximumMs) ||
    boundaryMs <= Date.parse(now)
  ) {
    throw new DomainError({
      code: "CONFLICT",
      message: "The mailbox verification request has no usable review window.",
    });
  }
  return new Date(Math.min(boundaryMs, maximumMs)).toISOString();
}

function hasExpired(expiresAt: string, now: string): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  const nowMs = Date.parse(now);
  return Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs;
}

async function readAlertBody(request: Request): Promise<unknown> {
  return readBoundedJsonBody(request, {
    maxBytes: MAX_REQUEST_BODY_BYTES,
    emptyMessage: "Expected a bounded search alert request body.",
  });
}

function readRequiredIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim();
  if (key === undefined || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new DomainError({
      code: "VALIDATION",
      message:
        "Idempotency-Key is required and must be 1-128 characters of letters, digits, '_', '.', ':' or '-'.",
    });
  }
  return key;
}

async function rateLimit(
  keys: readonly string[],
  limit: number,
  requestId: string,
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<Response | null> {
  for (const key of keys) {
    const result = await dependencies.identity.rateLimiter.check({
      key,
      limit,
      windowMs: 15 * 60 * 1_000,
      nowMs: dependencies.identity.nowMs(),
    });
    if (!result.allowed) {
      return apiErrorResponse(
        new DomainError({
          code: "RATE_LIMITED",
          message: "Too many search alert requests. Try again later.",
          retryable: true,
        }),
        { requestId, retryAfterSeconds: result.retryAfterSeconds },
      );
    }
  }
  return null;
}

function storedRequestPayload(
  stored: IdempotencyRecord | null,
  expectedOwnerId: string,
  expectedRequestId: string,
  dependencies: SearchAlertAgentRouteDependencies,
): SearchAlertReviewPayload {
  if (stored === null) {
    throw new DomainError({
      code: "UNAUTHORIZED",
      message: "The search alert review is no longer available.",
      details: { reason: "stale_review" },
    });
  }
  let persisted: SearchAlertReviewPayload;
  try {
    persisted = searchAlertReviewPayloadSchema.parse(stored.responseBody);
  } catch {
    throw new DomainError({
      code: "UNAUTHORIZED",
      message: "The search alert review is no longer valid.",
      details: { reason: "stale_review" },
    });
  }
  if (
    persisted.ownerId !== expectedOwnerId ||
    persisted.requestId !== expectedRequestId ||
    stored.requestHash !==
      createSearchAlertReviewBinding(dependencies.identity.environment, persisted, "review")
  ) {
    throw new DomainError({
      code: "UNAUTHORIZED",
      message: "The search alert review does not match its server request.",
      details: { reason: "stale_review" },
    });
  }
  return persisted;
}

function validateStoredRequest(
  stored: IdempotencyRecord | null,
  payload: SearchAlertReviewPayload,
  dependencies: SearchAlertAgentRouteDependencies,
): void {
  const persisted = storedRequestPayload(stored, payload.ownerId, payload.requestId, dependencies);
  if (!isDeepStrictEqual(persisted, payload)) {
    throw new DomainError({
      code: "UNAUTHORIZED",
      message: "The search alert review does not match its server request.",
      details: { reason: "stale_review" },
    });
  }
}

function requestResultFromPayload(
  payload: SearchAlertReviewPayload,
  maskedDestination: string,
  dependencies: SearchAlertAgentRouteDependencies,
) {
  return requestSearchAlertResultSchema.parse({
    status: "requires_user_action",
    requestId: payload.requestId,
    reviewToken: dependencies.reviewCodec.sign(payload),
    expiresAt: payload.expiresAt,
    review: {
      savedSearchId: payload.savedSearchId,
      savedSearchVersion: payload.savedSearchVersion,
      maskedDestination,
      deliveryVerification: payload.deliveryVerificationRequired
        ? { required: true, method: "email_code" }
        : { required: false, method: null },
      criteria: payload.criteria,
      recurrence: payload.recurrence,
      firstRunAt: payload.firstRunAt,
      ...reviewCopy,
      privacyNoticeVersion: payload.privacyNoticeVersion,
    },
  });
}

function assertRestorableRequest(
  payload: SearchAlertReviewPayload,
  saga: SearchAlertRequestSaga,
  savedSearch: SavedSearch,
  recurrence: ScheduleRecurrence,
  now: string,
): void {
  if (
    hasExpired(payload.expiresAt, now) ||
    payload.ownerId !== saga.ownerId ||
    payload.requestId !== saga.requestId ||
    payload.savedSearchId !== saga.savedSearchId ||
    payload.challengeId !== saga.challengeId ||
    payload.scheduleId !== saga.scheduleId ||
    payload.issuedAt !== saga.issuedAt ||
    payload.savedSearchVersion !== savedSearch.version ||
    !isDeepStrictEqual(payload.criteria, savedSearch.criteria) ||
    !isDeepStrictEqual(payload.recurrence, recurrence) ||
    payload.privacyNoticeVersion !== searchAlertReviewPolicy.privacyNoticeVersion
  ) {
    throw new DomainError({
      code: "CONFLICT",
      message: "The persisted search alert review no longer matches this exact request.",
      details: { reason: "stale_review" },
    });
  }
}

function createDecisionEnvelope(
  payload: SearchAlertReviewPayload,
  result: ReturnType<typeof decideSearchAlertResultSchema.parse>,
  dependencies: SearchAlertAgentRouteDependencies,
): SearchAlertDecisionEnvelope {
  const reviewBinding = createSearchAlertReviewBinding(
    dependencies.identity.environment,
    payload,
    result.decision,
  );
  return searchAlertDecisionEnvelopeSchema.parse({
    version: 1,
    status: "completed",
    receipt: result,
    evidence: {
      reviewBinding,
      ...reviewCopy,
      criteria: payload.criteria,
      savedSearchId: payload.savedSearchId,
      savedSearchVersion: payload.savedSearchVersion,
      endpointId: payload.endpointId,
      recurrence: payload.recurrence,
      firstRunAt: payload.firstRunAt,
      privacyNoticeVersion: payload.privacyNoticeVersion,
      channel: "agent_client",
      decidedAt: result.decidedAt,
    },
  });
}

function createDecisionRecord(
  ownerId: string,
  payload: SearchAlertReviewPayload,
  result: ReturnType<typeof decideSearchAlertResultSchema.parse>,
  now: string,
  dependencies: SearchAlertAgentRouteDependencies,
): IdempotencyRecord {
  const envelope = createDecisionEnvelope(payload, result, dependencies);
  return {
    scope: decisionScope(ownerId),
    key: payload.requestId,
    requestHash: envelope.evidence.reviewBinding,
    responseStatus: result.decision === "approved" ? 201 : 200,
    responseBody: envelope,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + DECISION_RETENTION_MS).toISOString(),
  };
}

function validateDecisionRecord(
  stored: IdempotencyRecord,
  payload: SearchAlertReviewPayload,
  expectedDecision: "approved" | "declined",
  dependencies: SearchAlertAgentRouteDependencies,
): SearchAlertDecisionEnvelope {
  const expectedBinding = createSearchAlertReviewBinding(
    dependencies.identity.environment,
    payload,
    expectedDecision,
  );
  const envelope = searchAlertDecisionEnvelopeSchema.parse(stored.responseBody);
  if (
    stored.requestHash !== expectedBinding ||
    envelope.evidence.reviewBinding !== expectedBinding ||
    envelope.receipt.decision !== expectedDecision
  ) {
    throw new DomainError({
      code: "CONFLICT",
      message: "This search alert review already has a different decision.",
      details: { reason: "already_decided" },
    });
  }
  return envelope;
}

async function existingDecision(
  ownerId: string,
  payload: SearchAlertReviewPayload,
  expectedDecision: "approved" | "declined",
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<ReturnType<typeof decideSearchAlertResultSchema.parse> | null> {
  const stored = await dependencies.idempotency.get(decisionScope(ownerId), payload.requestId);
  if (stored === null) return null;
  return validateDecisionRecord(stored, payload, expectedDecision, dependencies).receipt;
}

async function existingDecisionReplay(
  ownerId: string,
  requestId: string,
  expectedDecision: "approved" | "declined",
  now: string,
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<ReturnType<typeof decideSearchAlertResultSchema.parse> | null> {
  const stored = await dependencies.idempotency.get(decisionScope(ownerId), requestId);
  if (stored === null) return null;
  const envelope = searchAlertDecisionEnvelopeSchema.parse(stored.responseBody);
  if (
    stored.key !== requestId ||
    stored.requestHash !== envelope.evidence.reviewBinding ||
    envelope.receipt.requestId !== requestId ||
    envelope.receipt.decision !== expectedDecision
  ) {
    throw new DomainError({
      code: "CONFLICT",
      message: "This search alert review already has a different decision.",
      details: { reason: "already_decided" },
    });
  }
  if (hasExpired(stored.expiresAt, now)) {
    await dependencies.idempotency.deleteExact(idempotencyIdentity(stored));
    return null;
  }
  return envelope.receipt;
}

function validateDecisionIntent(
  stored: IdempotencyRecord,
  payload: SearchAlertReviewPayload,
  decision: "approved" | "declined",
  dependencies: SearchAlertAgentRouteDependencies,
): SearchAlertDecisionIntent {
  const reviewBinding = createSearchAlertReviewBinding(
    dependencies.identity.environment,
    payload,
    decision,
  );
  const persisted = searchAlertDecisionIntentSchema.parse(stored.responseBody);
  if (
    stored.requestHash !== reviewBinding ||
    persisted.requestId !== payload.requestId ||
    persisted.reviewBinding !== reviewBinding ||
    persisted.decision !== decision ||
    Date.parse(persisted.recordedAt) >= Date.parse(payload.expiresAt)
  ) {
    throw new DomainError({
      code: "CONFLICT",
      message: "This search alert review already has a different decision intent.",
      details: { reason: "already_decided" },
    });
  }
  return persisted;
}

async function existingDecisionIntent(
  ownerId: string,
  payload: SearchAlertReviewPayload,
  decision: "approved" | "declined",
  now: string,
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<{
  readonly intent: SearchAlertDecisionIntent;
  readonly record: IdempotencyRecord;
} | null> {
  const stored = await dependencies.idempotency.get(
    decisionIntentScope(ownerId),
    payload.requestId,
  );
  if (stored === null || hasExpired(stored.expiresAt, now)) return null;
  return {
    intent: validateDecisionIntent(stored, payload, decision, dependencies),
    record: stored,
  };
}

async function recoverDecisionAfterLifecycleConflict(
  error: unknown,
  ownerId: string,
  payload: SearchAlertReviewPayload,
  decision: "approved" | "declined",
  now: string,
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<ReturnType<typeof decideSearchAlertResultSchema.parse>> {
  if (!isDomainError(error) || error.code !== "CONFLICT") throw error;
  const completed = await existingDecision(ownerId, payload, decision, dependencies);
  if (completed !== null) return completed;
  await existingDecisionIntent(ownerId, payload, decision, now, dependencies);
  throw new DomainError({
    code: "CONFLICT",
    message: "The exact search alert review is no longer actionable.",
    details: { reason: "stale_review" },
    cause: error,
  });
}

function createDecisionIntentRecord(
  ownerId: string,
  payload: SearchAlertReviewPayload,
  decision: "approved" | "declined",
  now: string,
  dependencies: SearchAlertAgentRouteDependencies,
): IdempotencyRecord {
  const reviewBinding = createSearchAlertReviewBinding(
    dependencies.identity.environment,
    payload,
    decision,
  );
  const intent = searchAlertDecisionIntentSchema.parse({
    version: 1,
    status: "deciding",
    requestId: payload.requestId,
    reviewBinding,
    decision,
    recordedAt: now,
  });
  return {
    scope: decisionIntentScope(ownerId),
    key: payload.requestId,
    requestHash: reviewBinding,
    responseStatus: 202,
    responseBody: intent,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + DECISION_INTENT_LIFETIME_MS).toISOString(),
  };
}

async function existingRequestResult(
  ownerId: string,
  idempotencyKey: string,
  requestHash: string,
  dependencies: SearchAlertAgentRouteDependencies,
) {
  const stored = await dependencies.idempotency.get(requestResultScope(ownerId), idempotencyKey);
  if (stored === null) return null;
  if (stored.requestHash !== requestHash) {
    throw new DomainError({
      code: "CONFLICT",
      message: "The idempotency key is already bound to a different search alert request.",
    });
  }
  if (hasExpired(stored.expiresAt, dependencies.identity.now())) {
    await dependencies.idempotency.deleteExact(idempotencyIdentity(stored));
    return null;
  }
  return requestSearchAlertResultSchema.parse(stored.responseBody);
}

function idempotencyIdentity(record: IdempotencyRecord): IdempotencyRecordIdentity {
  return {
    scope: record.scope,
    key: record.key,
    requestHash: record.requestHash,
    responseBody: record.responseBody,
  };
}

interface DurableRequestSaga {
  readonly saga: SearchAlertRequestSaga;
  readonly record: SearchAlertPreparationSagaRecord;
}

function preparationSagaRecord(record: IdempotencyRecord): SearchAlertPreparationSagaRecord {
  const saga = searchAlertRequestSagaSchema.parse(record.responseBody);
  return { ...record, responseBody: saga };
}

async function loadOrCreateRequestSaga(
  ownerId: string,
  idempotencyKey: string,
  requestHash: string,
  now: string,
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<DurableRequestSaga> {
  const candidate: IdempotencyRecord = {
    scope: requestSagaScope(ownerId),
    key: idempotencyKey,
    requestHash,
    responseStatus: 202,
    responseBody: {
      version: 1,
      status: "preparing",
      ownerId,
      requestId: dependencies.ids.request(),
      savedSearchId: dependencies.ids.savedSearch(),
      endpointId: dependencies.ids.endpoint(),
      challengeId: dependencies.ids.challenge(),
      scheduleId: dependencies.ids.schedule(),
      issuedAt: now,
    },
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + REVIEW_LIFETIME_MS).toISOString(),
  };
  let put = await dependencies.idempotency.putIfAbsent(candidate);
  if (!put.inserted && hasExpired(put.record.expiresAt, now)) {
    const released = await dependencies.preparation.compensate({
      saga: preparationSagaRecord(put.record),
      now,
    });
    if (released) put = await dependencies.idempotency.putIfAbsent(candidate);
  }
  if (!put.inserted && hasExpired(put.record.expiresAt, now)) {
    throw new DomainError({
      code: "CONFLICT",
      message: "The previous search alert preparation is expiring. Retry shortly.",
      retryable: true,
    });
  }
  const record = preparationSagaRecord(put.record);
  return { saga: record.responseBody, record };
}

async function claimRequestPreparation(
  ownerId: string,
  idempotencyKey: string,
  requestHash: string,
  now: string,
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<IdempotencyRecordIdentity> {
  const claim = {
    scope: requestClaimScope(ownerId),
    key: idempotencyKey,
    requestHash,
  };
  const record = {
    ...claim,
    responseStatus: 202,
    responseBody: { status: "preparing", claimId: dependencies.ids.claim() },
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + REQUEST_CLAIM_LIFETIME_MS).toISOString(),
  };
  let put = await dependencies.idempotency.putIfAbsent(record);
  if (!put.inserted && hasExpired(put.record.expiresAt, now)) {
    const released = await dependencies.idempotency.deleteExact(idempotencyIdentity(put.record));
    if (released) put = await dependencies.idempotency.putIfAbsent(record);
  }
  if (!put.inserted) {
    throw new DomainError({
      code: "CONFLICT",
      message: "This search alert request is already being prepared.",
      retryable: true,
    });
  }
  return idempotencyIdentity(record);
}

type DecisionClaim = IdempotencyRecordIdentity;

function searchAlertIdentity(dependencies: SearchAlertAgentRouteDependencies) {
  const operations = dependencies.identity.identity;
  if (
    operations.startSearchAlertEmailVerification === undefined ||
    operations.confirmSearchAlertEmailVerification === undefined ||
    operations.abandonSearchAlertEmailVerification === undefined
  ) {
    throw new Error("Search alert verification operations are not configured.");
  }
  return {
    start: operations.startSearchAlertEmailVerification.bind(operations),
    confirm: operations.confirmSearchAlertEmailVerification.bind(operations),
    abandon: operations.abandonSearchAlertEmailVerification.bind(operations),
  };
}

async function claimDecision(
  ownerId: string,
  payload: SearchAlertReviewPayload,
  decision: "approved" | "declined",
  now: string,
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<DecisionClaim> {
  const reviewBinding = createSearchAlertReviewBinding(
    dependencies.identity.environment,
    payload,
    decision,
  );
  const claim = {
    scope: decisionClaimScope(ownerId),
    key: payload.requestId,
    requestHash: reviewBinding,
  };
  const record = {
    ...claim,
    responseStatus: 202,
    responseBody: {
      status: "deciding",
      requestId: payload.requestId,
      decision,
      claimId: dependencies.ids.claim(),
    },
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + REQUEST_CLAIM_LIFETIME_MS).toISOString(),
  };
  let put = await dependencies.idempotency.putIfAbsent(record);
  if (!put.inserted && hasExpired(put.record.expiresAt, now)) {
    const released = await dependencies.idempotency.deleteExact(idempotencyIdentity(put.record));
    if (released) put = await dependencies.idempotency.putIfAbsent(record);
  }
  if (!put.inserted) {
    throw new DomainError({
      code: "CONFLICT",
      message: "This search alert review already has a decision in progress.",
      retryable: true,
    });
  }
  return idempotencyIdentity(record);
}

async function releaseDecisionClaim(
  claim: DecisionClaim,
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<void> {
  await dependencies.idempotency.deleteExact(claim);
}

export async function handleRequestSearchAlert(
  request: Request,
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<Response> {
  const apiRequestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.identity.environment);
    const current = await requireOwnerSession(request, dependencies.identity);
    const input = requestSearchAlertInputSchema.parse(await readAlertBody(request));
    const idempotencyKey = readRequiredIdempotencyKey(request);
    const keyedAddressId = sensitiveRateLimitKey(
      "agent-search-alert-address-binding",
      input.delivery.email,
      dependencies.identity.environment,
    );
    const requestHash = createSearchAlertRequestBinding(
      dependencies.identity.environment,
      {
        name: input.name,
        criteria: input.criteria,
        recurrence: input.recurrence,
        delivery: { channel: "email" },
      },
      keyedAddressId,
    );
    const replay = await existingRequestResult(
      current.owner.id,
      idempotencyKey,
      requestHash,
      dependencies,
    );
    if (replay !== null) {
      return apiSuccessResponse(replay, { requestId: apiRequestId, status: 202 });
    }
    const limited = await rateLimit(
      [
        getRateLimitKey(request, "agent-search-alert-request", dependencies.identity.environment),
        sensitiveRateLimitKey(
          "agent-search-alert-owner",
          current.owner.id,
          dependencies.identity.environment,
        ),
        sensitiveRateLimitKey(
          "agent-search-alert-address",
          input.delivery.email,
          dependencies.identity.environment,
        ),
      ],
      5,
      apiRequestId,
      dependencies,
    );
    if (limited !== null) return limited;

    const now = dependencies.identity.now();
    const durableSaga = await loadOrCreateRequestSaga(
      current.owner.id,
      idempotencyKey,
      requestHash,
      now,
      dependencies,
    );
    const claim = await claimRequestPreparation(
      current.owner.id,
      idempotencyKey,
      requestHash,
      now,
      dependencies,
    );
    let savedSearch: SavedSearch | null = null;
    let verification: PreparedSearchAlertEmailVerification | null = null;
    let requestEvidence: DecisionClaim | null = null;
    let resultStored = false;
    let preservePreparation = false;
    try {
      const decisionAfterClaim = await existingRequestResult(
        current.owner.id,
        idempotencyKey,
        requestHash,
        dependencies,
      );
      if (decisionAfterClaim !== null) {
        return apiSuccessResponse(decisionAfterClaim, {
          requestId: apiRequestId,
          status: 202,
        });
      }
      savedSearch = await dependencies.savedSearches.ensureSavedSearch(
        current.owner.id,
        durableSaga.saga.savedSearchId,
        { name: input.name, criteria: input.criteria },
        durableSaga.saga.issuedAt,
      );
      const persistedEvidence = await dependencies.idempotency.get(
        requestScope(current.owner.id),
        durableSaga.saga.requestId,
      );
      if (persistedEvidence !== null) {
        const persistedPayload = storedRequestPayload(
          persistedEvidence,
          current.owner.id,
          durableSaga.saga.requestId,
          dependencies,
        );
        assertRestorableRequest(
          persistedPayload,
          durableSaga.saga,
          savedSearch,
          input.recurrence,
          now,
        );
        const persistedEndpoint = (
          await dependencies.identity.identity.listVerificationEndpoints(current.owner.id)
        ).find((candidate) => candidate.id === persistedPayload.endpointId);
        if (
          persistedEndpoint === undefined ||
          persistedEndpoint.status === "revoked" ||
          (!persistedPayload.deliveryVerificationRequired &&
            persistedEndpoint.status !== "verified")
        ) {
          throw new DomainError({
            code: "CONFLICT",
            message: "The reviewed delivery destination is no longer available.",
            details: { reason: "stale_review" },
          });
        }
        const restored = requestResultFromPayload(
          persistedPayload,
          persistedEndpoint.maskedAddress,
          dependencies,
        );
        const restoredPut = await dependencies.idempotency.putIfAbsent({
          scope: requestResultScope(current.owner.id),
          key: idempotencyKey,
          requestHash,
          responseStatus: 202,
          responseBody: restored,
          createdAt: now,
          expiresAt: persistedPayload.expiresAt,
        });
        const result = requestSearchAlertResultSchema.parse(restoredPut.record.responseBody);
        resultStored = true;
        if (restoredPut.inserted) {
          await dependencies.activity?.publish({
            ownerId: current.owner.id,
            correlationId: persistedPayload.requestId,
            kind: "schedule",
            key: "request_search_alert",
            status: "requires_user_action",
            safeSummary: "Job alert review restored for an agent-client decision.",
            actorKind: "agent",
            aggregate: { type: "saved_search", version: savedSearch.version },
            occurredAt: now,
            effects: [
              { target: "saved_searches", kind: "refresh" },
              { target: "agent_activity", kind: "announce" },
            ],
          });
        }
        return apiSuccessResponse(result, { requestId: apiRequestId, status: 202 });
      }
      verification = await searchAlertIdentity(dependencies).start(
        current.owner.id,
        { email: input.delivery.email },
        durableSaga.saga.issuedAt,
        {
          endpointId: durableSaga.saga.endpointId,
          challengeId: durableSaga.saga.challengeId,
        },
      );
      const expiresAt = expiresWithin(verification.expiresAt, now);
      const requestId = durableSaga.saga.requestId;
      const firstRunAt = dependencies.prospectiveRunAt(
        savedSearch.id,
        input.recurrence,
        durableSaga.saga.issuedAt,
      );
      const tokenPayload = searchAlertReviewPayloadSchema.parse({
        version: 1,
        purpose: "search_alert_activation",
        ownerId: current.owner.id,
        requestId,
        savedSearchId: savedSearch.id,
        savedSearchVersion: savedSearch.version,
        criteria: savedSearch.criteria,
        endpointId: verification.endpointId,
        challengeId: verification.challengeId,
        deliveryVerificationRequired: verification.verificationRequired,
        scheduleId: durableSaga.saga.scheduleId,
        recurrence: input.recurrence,
        firstRunAt,
        privacyNoticeVersion: searchAlertReviewPolicy.privacyNoticeVersion,
        issuedAt: durableSaga.saga.issuedAt,
        expiresAt,
      });
      if (verification.verificationRequired) {
        try {
          preservePreparation = true;
          await dependencies.identity.delivery.deliverVerification({
            encryptedAddress: verification.encryptedAddress,
            code: verification.rawCode,
            expiresAt: verification.expiresAt,
            challengeId: verification.challengeId,
          });
        } catch (error) {
          if (isDomainError(error) && !error.retryable) preservePreparation = false;
          throw error;
        }
      }
      requestEvidence = {
        scope: requestScope(current.owner.id),
        key: requestId,
        requestHash: createSearchAlertReviewBinding(
          dependencies.identity.environment,
          tokenPayload,
          "review",
        ),
        responseBody: tokenPayload,
      };
      const stored = await dependencies.idempotency.putIfAbsent({
        ...requestEvidence,
        responseStatus: 202,
        responseBody: tokenPayload,
        createdAt: now,
        expiresAt,
      });
      if (!stored.inserted) {
        validateStoredRequest(stored.record, tokenPayload, dependencies);
      }
      const result = requestResultFromPayload(
        tokenPayload,
        verification.maskedAddress,
        dependencies,
      );
      const resultPut = await dependencies.idempotency.putIfAbsent({
        scope: requestResultScope(current.owner.id),
        key: idempotencyKey,
        requestHash,
        responseStatus: 202,
        responseBody: result,
        createdAt: now,
        expiresAt,
      });
      if (!resultPut.inserted) {
        const persisted = requestSearchAlertResultSchema.parse(resultPut.record.responseBody);
        resultStored = true;
        return apiSuccessResponse(persisted, { requestId: apiRequestId, status: 202 });
      }
      resultStored = true;
      await dependencies.activity?.publish({
        ownerId: current.owner.id,
        correlationId: requestId,
        kind: "schedule",
        key: "request_search_alert",
        status: "requires_user_action",
        safeSummary: "Job alert review prepared for an agent-client decision.",
        actorKind: "agent",
        aggregate: { type: "saved_search", version: savedSearch.version },
        occurredAt: now,
        effects: [
          { target: "saved_searches", kind: "refresh" },
          { target: "agent_activity", kind: "announce" },
        ],
      });
      return apiSuccessResponse(result, { requestId: apiRequestId, status: 202 });
    } catch (error) {
      if (isDomainError(error) && error.retryable) preservePreparation = true;
      if (!resultStored && !preservePreparation) {
        await dependencies.preparation.compensate({
          saga: durableSaga.record,
          now,
        });
      }
      throw error;
    } finally {
      await dependencies.idempotency.deleteExact(claim);
    }
  } catch (error) {
    return apiErrorResponse(error, { requestId: apiRequestId });
  }
}

export async function handleDecideSearchAlert(
  request: Request,
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<Response> {
  const apiRequestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.identity.environment);
    const current = await requireOwnerSession(request, dependencies.identity);
    const input = decideSearchAlertInputSchema.parse(await readAlertBody(request));
    const limited = await rateLimit(
      [
        getRateLimitKey(request, "agent-search-alert-decision", dependencies.identity.environment),
        sensitiveRateLimitKey(
          "agent-search-alert-decision-owner",
          current.owner.id,
          dependencies.identity.environment,
        ),
        sensitiveRateLimitKey(
          "agent-search-alert-decision-request",
          input.requestId,
          dependencies.identity.environment,
        ),
      ],
      12,
      apiRequestId,
      dependencies,
    );
    if (limited !== null) return limited;

    const now = dependencies.identity.now();
    const tokenBinding = dependencies.reviewCodec.authenticate(
      input.reviewToken,
      current.owner.id,
      input.requestId,
    );
    const replay = await existingDecisionReplay(
      current.owner.id,
      input.requestId,
      input.decision,
      now,
      dependencies,
    );
    if (replay !== null) {
      return apiSuccessResponse(replay, { requestId: apiRequestId });
    }
    const storedRequest = await dependencies.idempotency.get(
      requestScope(current.owner.id),
      input.requestId,
    );
    if (storedRequest === null) {
      const decisionAfterRequestRace = await existingDecisionReplay(
        current.owner.id,
        input.requestId,
        input.decision,
        now,
        dependencies,
      );
      if (decisionAfterRequestRace !== null) {
        return apiSuccessResponse(decisionAfterRequestRace, { requestId: apiRequestId });
      }
      if (hasExpired(tokenBinding.expiresAt, now)) {
        const expired = await dependencies.preparation.expire({
          ownerId: current.owner.id,
          requestId: input.requestId,
          reviewEvidenceHash: createSearchAlertReviewBinding(
            dependencies.identity.environment,
            tokenBinding,
            "review",
          ),
          reviewExpiresAt: tokenBinding.expiresAt,
          now,
        });
        if (!expired) {
          const decisionAfterCleanupRace = await existingDecisionReplay(
            current.owner.id,
            input.requestId,
            input.decision,
            now,
            dependencies,
          );
          if (decisionAfterCleanupRace !== null) {
            return apiSuccessResponse(decisionAfterCleanupRace, { requestId: apiRequestId });
          }
        }
        throw new DomainError({
          code: "UNAUTHORIZED",
          message: "The search alert review has expired.",
          details: { reason: "expired_review" },
        });
      }
      throw new DomainError({
        code: "UNAUTHORIZED",
        message: "The search alert review is no longer available.",
        details: { reason: "stale_review" },
      });
    }
    const payload = storedRequestPayload(
      storedRequest,
      current.owner.id,
      input.requestId,
      dependencies,
    );
    if (tokenBinding.expiresAt !== payload.expiresAt) {
      throw new DomainError({
        code: "UNAUTHORIZED",
        message: "The decision does not match the exact search alert review.",
      });
    }

    const reviewEvidenceHash = createSearchAlertReviewBinding(
      dependencies.identity.environment,
      payload,
      "review",
    );
    let storedIntent = await existingDecisionIntent(
      current.owner.id,
      payload,
      input.decision,
      now,
      dependencies,
    );
    if (storedIntent === null) {
      if (hasExpired(payload.expiresAt, now)) {
        const expired = await dependencies.preparation.expire({
          ownerId: current.owner.id,
          requestId: payload.requestId,
          reviewEvidenceHash,
          reviewExpiresAt: payload.expiresAt,
          now,
        });
        if (!expired) {
          const decisionAfterCleanupRace = await existingDecision(
            current.owner.id,
            payload,
            input.decision,
            dependencies,
          );
          if (decisionAfterCleanupRace !== null) {
            return apiSuccessResponse(decisionAfterCleanupRace, { requestId: apiRequestId });
          }
        }
        throw new DomainError({
          code: "UNAUTHORIZED",
          message: "The search alert review has expired.",
          details: { reason: "expired_review" },
        });
      }
      const currentStoredRequest = await dependencies.idempotency.get(
        requestScope(current.owner.id),
        payload.requestId,
      );
      if (currentStoredRequest === null) {
        const decisionAfterValidationRace = await existingDecisionReplay(
          current.owner.id,
          input.requestId,
          input.decision,
          now,
          dependencies,
        );
        if (decisionAfterValidationRace !== null) {
          return apiSuccessResponse(decisionAfterValidationRace, { requestId: apiRequestId });
        }
      }
      validateStoredRequest(currentStoredRequest, payload, dependencies);
      dependencies.reviewCodec.verify(
        input.reviewToken,
        current.owner.id,
        input.requestId,
        payload.expiresAt,
        now,
      );

      if (input.decision === "approved") {
        const currentFirstRunAt = dependencies.prospectiveRunAt(
          payload.savedSearchId,
          payload.recurrence,
          now,
        );
        if (currentFirstRunAt !== payload.firstRunAt) {
          throw new DomainError({
            code: "CONFLICT",
            message: "The reviewed first alert run is no longer available.",
            details: { reason: "stale_review" },
          });
        }
        const reviewedSearch = (
          await dependencies.savedSearches.listSavedSearches(current.owner.id)
        ).find((candidate) => candidate.id === payload.savedSearchId);
        if (
          reviewedSearch === undefined ||
          reviewedSearch.version !== payload.savedSearchVersion ||
          !isDeepStrictEqual(reviewedSearch.criteria, payload.criteria)
        ) {
          throw new DomainError({
            code: "CONFLICT",
            message: "The saved search changed after this alert review was prepared.",
            details: { reason: "stale_review" },
          });
        }
        const reviewedEndpoint = (
          await dependencies.identity.identity.listVerificationEndpoints(current.owner.id)
        ).find((candidate) => candidate.id === payload.endpointId);
        if (
          reviewedEndpoint === undefined ||
          reviewedEndpoint.status === "revoked" ||
          (!payload.deliveryVerificationRequired && reviewedEndpoint.status !== "verified")
        ) {
          throw new DomainError({
            code: "CONFLICT",
            message: "The reviewed delivery destination is no longer available.",
            details: { reason: "stale_review" },
          });
        }
      }
    }

    if (input.decision === "declined") {
      const intentRecord =
        storedIntent?.record ??
        createDecisionIntentRecord(current.owner.id, payload, input.decision, now, dependencies);
      const intent = validateDecisionIntent(intentRecord, payload, input.decision, dependencies);
      const receipt = decideSearchAlertResultSchema.parse({
        status: "completed",
        requestId: payload.requestId,
        decision: "declined",
        channel: "agent_client",
        savedSearchId: payload.savedSearchId,
        scheduleId: null,
        nextRunAt: null,
        decidedAt: intent.recordedAt,
        summary: "Job alert activation declined. No schedule was created.",
      });
      let stored;
      try {
        stored = await dependencies.preparation.decline({
          ownerId: current.owner.id,
          requestId: payload.requestId,
          reviewEvidenceHash,
          intent: intentRecord,
          decision: createDecisionRecord(
            current.owner.id,
            payload,
            receipt,
            intent.recordedAt,
            dependencies,
          ),
          now,
        });
      } catch (error) {
        const recovered = await recoverDecisionAfterLifecycleConflict(
          error,
          current.owner.id,
          payload,
          input.decision,
          now,
          dependencies,
        );
        return apiSuccessResponse(recovered, { requestId: apiRequestId });
      }
      const envelope = validateDecisionRecord(stored.record, payload, "declined", dependencies);
      if (stored.inserted) {
        await dependencies.activity?.publish({
          ownerId: current.owner.id,
          correlationId: payload.requestId,
          kind: "schedule",
          key: "decide_search_alert",
          status: "completed",
          safeSummary: "Job alert activation declined through the agent client.",
          actorKind: "agent",
          aggregate: { type: "saved_search", version: payload.savedSearchVersion },
          occurredAt: intent.recordedAt,
          effects: [
            { target: "saved_searches", kind: "refresh" },
            { target: "agent_activity", kind: "announce" },
          ],
        });
      }
      return apiSuccessResponse(envelope.receipt, { requestId: apiRequestId });
    }

    if (storedIntent === null) {
      const intent = createDecisionIntentRecord(
        current.owner.id,
        payload,
        input.decision,
        now,
        dependencies,
      );
      let begun;
      try {
        begun = await dependencies.preparation.beginApproved({
          ownerId: current.owner.id,
          requestId: payload.requestId,
          reviewEvidenceHash,
          intent,
          now,
        });
      } catch (error) {
        const recovered = await recoverDecisionAfterLifecycleConflict(
          error,
          current.owner.id,
          payload,
          input.decision,
          now,
          dependencies,
        );
        return apiSuccessResponse(recovered, { requestId: apiRequestId });
      }
      storedIntent = {
        intent: validateDecisionIntent(begun.record, payload, input.decision, dependencies),
        record: begun.record,
      };
    }

    const intent = storedIntent.intent;
    const claim = await claimDecision(current.owner.id, payload, input.decision, now, dependencies);
    try {
      const decisionAfterClaim = await existingDecision(
        current.owner.id,
        payload,
        input.decision,
        dependencies,
      );
      if (decisionAfterClaim !== null) {
        return apiSuccessResponse(decisionAfterClaim, { requestId: apiRequestId });
      }

      let verifiedEndpointId = payload.endpointId;
      if (payload.deliveryVerificationRequired) {
        if (input.code === undefined) {
          throw new DomainError({
            code: "VALIDATION",
            message: "Enter the 6-digit code sent to the reviewed email address.",
            details: { reason: "verification_code_required" },
          });
        }
        let verified;
        try {
          verified = await searchAlertIdentity(dependencies).confirm(
            current.owner.id,
            { challengeId: payload.challengeId, code: input.code },
            now,
          );
        } catch (error) {
          if (isDomainError(error) && error.code === "UNAUTHORIZED") {
            throw new DomainError({
              code: "UNAUTHORIZED",
              message: "The mailbox verification code is invalid.",
              details: { reason: "invalid_code" },
            });
          }
          throw error;
        }
        if (verified.endpointId !== payload.endpointId) {
          throw new DomainError({
            code: "CONFLICT",
            message: "Mailbox verification did not match the reviewed delivery destination.",
            details: { reason: "stale_review" },
          });
        }
        verifiedEndpointId = verified.endpointId;
      } else if (input.code !== undefined) {
        throw new DomainError({
          code: "VALIDATION",
          message: "This destination is already verified; no mailbox code is needed.",
          details: { reason: "verification_code_not_required" },
        });
      }

      const schedule: ScheduleRecord = {
        id: payload.scheduleId,
        ownerId: current.owner.id,
        savedSearchId: payload.savedSearchId,
        recurrence: payload.recurrence,
        deliveryChannel: "email",
        deliveryEndpointId: payload.endpointId,
        enabled: true,
        nextRunAt: payload.firstRunAt,
        version: 0,
        createdAt: intent.recordedAt,
        updatedAt: intent.recordedAt,
      };
      const receipt = decideSearchAlertResultSchema.parse({
        status: "completed",
        requestId: payload.requestId,
        decision: "approved",
        channel: "agent_client",
        savedSearchId: payload.savedSearchId,
        scheduleId: schedule.id,
        nextRunAt: schedule.nextRunAt,
        decidedAt: intent.recordedAt,
        summary: "Job alert activated for the reviewed search and destination.",
      });
      let committed;
      try {
        committed = await dependencies.preparation.commitApproved({
          ownerId: current.owner.id,
          requestId: payload.requestId,
          reviewEvidenceHash,
          intent: storedIntent.record,
          now,
          schedule,
          expectedSavedSearchVersion: payload.savedSearchVersion,
          verifiedEndpointId,
          decision: createDecisionRecord(
            current.owner.id,
            payload,
            receipt,
            intent.recordedAt,
            dependencies,
          ),
        });
      } catch (error) {
        const recovered = await recoverDecisionAfterLifecycleConflict(
          error,
          current.owner.id,
          payload,
          input.decision,
          now,
          dependencies,
        );
        return apiSuccessResponse(recovered, { requestId: apiRequestId });
      }
      const envelope = validateDecisionRecord(
        committed.decision,
        payload,
        "approved",
        dependencies,
      );
      if (committed.inserted) {
        await dependencies.activity?.publish({
          ownerId: current.owner.id,
          correlationId: payload.requestId,
          kind: "schedule",
          key: "decide_search_alert",
          status: "completed",
          safeSummary: "Job alert activated after an agent-client decision.",
          actorKind: "agent",
          aggregate: { type: "schedule", version: committed.schedule.version },
          occurredAt: intent.recordedAt,
          effects: [
            { target: "saved_searches", kind: "refresh" },
            { target: "agent_activity", kind: "announce" },
          ],
        });
      }
      return apiSuccessResponse(envelope.receipt, {
        requestId: apiRequestId,
        status: committed.inserted ? 201 : 200,
      });
    } finally {
      await releaseDecisionClaim(claim, dependencies);
    }
  } catch (error) {
    return apiErrorResponse(error, { requestId: apiRequestId });
  }
}
