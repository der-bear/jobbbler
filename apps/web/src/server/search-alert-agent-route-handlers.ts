import { createHash } from "node:crypto";

import {
  decideSearchAlertInputSchema,
  decideSearchAlertResultSchema,
  requestSearchAlertInputSchema,
  requestSearchAlertResultSchema,
  type JobAlertSchedule,
  type SavedSearch,
  type ScheduleRecurrence,
} from "@jobbbler/contracts";
import { DomainError } from "@jobbbler/core-domain";
import type { IdempotencyRecord, IdempotencyRepository } from "@jobbbler/storage";

import { apiErrorResponse, apiSuccessResponse } from "./api-response";
import { readBoundedJsonBody } from "./bounded-json-body";
import { createRequestId, getRateLimitKey } from "./context";
import type { IdentityRouteDependencies } from "./identity-route-handlers";
import { requireOwnerSession } from "./identity-route-handlers";
import { assertTrustedMutationOrigin, sensitiveRateLimitKey } from "./identity-security";
import type { OwnerActivityPublisher } from "./owner-activity-publisher";
import {
  searchAlertReviewPayloadSchema,
  type SearchAlertReviewPayload,
  type createSearchAlertReviewCodec,
} from "./search-alert-review-token";

const MAX_REQUEST_BODY_BYTES = 16_384;
const REVIEW_LIFETIME_MS = 15 * 60 * 1_000;
const DECISION_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;
const REQUEST_SCOPE_PREFIX = "search_alert.request";
const DECISION_SCOPE_PREFIX = "search_alert.decision";
const PRIVACY_NOTICE_VERSION = "search-alert-v1";

const reviewCopy = {
  purpose: "Store this search and email matching-job updates.",
  dataCategories: ["saved_search_criteria", "delivery_email"] as const,
  retention: "Stored until the alert or delivery destination is removed.",
  withdrawal: "Pause or delete the alert, or revoke its delivery destination, at any time.",
} as const;

export interface SearchAlertAgentRouteDependencies {
  readonly identity: IdentityRouteDependencies;
  readonly savedSearches: {
    createSavedSearch(ownerId: string, input: unknown, now: string): Promise<SavedSearch>;
    listSavedSearches(ownerId: string): Promise<SavedSearch[]>;
    scheduleAlert(ownerId: string, input: unknown, now: string): Promise<JobAlertSchedule>;
  };
  readonly idempotency: Pick<IdempotencyRepository, "get" | "putIfAbsent">;
  readonly activity?: OwnerActivityPublisher;
  readonly reviewCodec: ReturnType<typeof createSearchAlertReviewCodec>;
  readonly prospectiveRunAt: (
    savedSearchId: string,
    recurrence: ScheduleRecurrence,
    now: string,
  ) => string;
}

function requestScope(ownerId: string): string {
  return `${REQUEST_SCOPE_PREFIX}:${ownerId}`;
}

function decisionScope(ownerId: string): string {
  return `${DECISION_SCOPE_PREFIX}:${ownerId}`;
}

function recordHash(value: unknown): string {
  return createHash("sha256")
    .update("jobbbler:search-alert-agent-record:v1\u0000")
    .update(JSON.stringify(value) ?? "")
    .digest("hex");
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

async function readAlertBody(request: Request): Promise<unknown> {
  return readBoundedJsonBody(request, {
    maxBytes: MAX_REQUEST_BODY_BYTES,
    emptyMessage: "Expected a bounded search alert request body.",
  });
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

function validateStoredRequest(
  stored: IdempotencyRecord | null,
  payload: SearchAlertReviewPayload,
): void {
  if (stored === null) {
    throw new DomainError({
      code: "UNAUTHORIZED",
      message: "The search alert review is no longer available.",
    });
  }
  let persisted: SearchAlertReviewPayload;
  try {
    persisted = searchAlertReviewPayloadSchema.parse(stored.responseBody);
  } catch {
    throw new DomainError({
      code: "UNAUTHORIZED",
      message: "The search alert review is no longer valid.",
    });
  }
  if (
    stored.requestHash !== recordHash(payload) ||
    JSON.stringify(persisted) !== JSON.stringify(payload)
  ) {
    throw new DomainError({
      code: "UNAUTHORIZED",
      message: "The search alert review does not match its server request.",
    });
  }
}

async function persistDecision(
  ownerId: string,
  payload: SearchAlertReviewPayload,
  result: ReturnType<typeof decideSearchAlertResultSchema.parse>,
  now: string,
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<ReturnType<typeof decideSearchAlertResultSchema.parse>> {
  const put = await dependencies.idempotency.putIfAbsent({
    scope: decisionScope(ownerId),
    key: payload.requestId,
    requestHash: recordHash({ requestId: payload.requestId, decision: result.decision }),
    responseStatus: result.decision === "approved" ? 201 : 200,
    responseBody: result,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + DECISION_RETENTION_MS).toISOString(),
  });
  const persisted = decideSearchAlertResultSchema.parse(put.record.responseBody);
  if (persisted.decision !== result.decision) {
    throw new DomainError({
      code: "CONFLICT",
      message: "This search alert review already has a different decision.",
    });
  }
  return persisted;
}

async function existingDecision(
  ownerId: string,
  requestId: string,
  expectedDecision: "approved" | "declined",
  dependencies: SearchAlertAgentRouteDependencies,
): Promise<ReturnType<typeof decideSearchAlertResultSchema.parse> | null> {
  const stored = await dependencies.idempotency.get(decisionScope(ownerId), requestId);
  if (stored === null) return null;
  const result = decideSearchAlertResultSchema.parse(stored.responseBody);
  if (result.decision !== expectedDecision) {
    throw new DomainError({
      code: "CONFLICT",
      message: "This search alert review already has a different decision.",
    });
  }
  return result;
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
    const savedSearch = await dependencies.savedSearches.createSavedSearch(
      current.owner.id,
      { name: input.name, criteria: input.criteria },
      now,
    );
    const verification = await dependencies.identity.identity.startEmailVerification(
      current.owner.id,
      { email: input.delivery.email },
      now,
    );
    await dependencies.identity.delivery.deliverVerification({
      encryptedAddress: verification.encryptedAddress,
      code: verification.rawCode,
      expiresAt: verification.expiresAt,
      challengeId: verification.challengeId,
    });
    const requestId = createRequestId();
    const expiresAt = expiresWithin(verification.expiresAt, now);
    const firstRunAt = dependencies.prospectiveRunAt(savedSearch.id, input.recurrence, now);
    const tokenPayload = searchAlertReviewPayloadSchema.parse({
      version: 1,
      purpose: "search_alert_activation",
      ownerId: current.owner.id,
      requestId,
      savedSearchId: savedSearch.id,
      savedSearchVersion: savedSearch.version,
      endpointId: verification.endpointId,
      challengeId: verification.challengeId,
      recurrence: input.recurrence,
      firstRunAt,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      issuedAt: now,
      expiresAt,
    });
    const reviewToken = dependencies.reviewCodec.sign(tokenPayload);
    const stored = await dependencies.idempotency.putIfAbsent({
      scope: requestScope(current.owner.id),
      key: requestId,
      requestHash: recordHash(tokenPayload),
      responseStatus: 202,
      responseBody: tokenPayload,
      createdAt: now,
      expiresAt,
    });
    if (!stored.inserted) {
      throw new DomainError({
        code: "CONFLICT",
        message: "Could not create a unique search alert review. Retry the request.",
        retryable: true,
      });
    }
    const result = requestSearchAlertResultSchema.parse({
      status: "requires_user_action",
      requestId,
      reviewToken,
      expiresAt,
      review: {
        savedSearchId: savedSearch.id,
        savedSearchVersion: savedSearch.version,
        maskedDestination: verification.maskedAddress,
        criteria: savedSearch.criteria,
        recurrence: input.recurrence,
        firstRunAt,
        ...reviewCopy,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      },
    });
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
    const payload = dependencies.reviewCodec.verify(input.reviewToken, current.owner.id, now);
    if (payload.requestId !== input.requestId) {
      throw new DomainError({
        code: "UNAUTHORIZED",
        message: "The decision does not match the exact search alert review.",
      });
    }
    validateStoredRequest(
      await dependencies.idempotency.get(requestScope(current.owner.id), payload.requestId),
      payload,
    );
    const replay = await existingDecision(
      current.owner.id,
      payload.requestId,
      input.decision,
      dependencies,
    );
    if (replay !== null) {
      return apiSuccessResponse(replay, { requestId: apiRequestId });
    }

    const savedSearch = (await dependencies.savedSearches.listSavedSearches(current.owner.id)).find(
      (candidate) => candidate.id === payload.savedSearchId,
    );
    if (savedSearch === undefined || savedSearch.version !== payload.savedSearchVersion) {
      throw new DomainError({
        code: "CONFLICT",
        message: "The saved search changed after this alert review was prepared.",
      });
    }
    const endpoint = (
      await dependencies.identity.identity.listVerificationEndpoints(current.owner.id)
    ).find((candidate) => candidate.id === payload.endpointId);
    if (endpoint === undefined || endpoint.status === "revoked") {
      throw new DomainError({
        code: "CONFLICT",
        message: "The reviewed delivery destination is no longer available.",
      });
    }

    if (input.decision === "declined") {
      const result = await persistDecision(
        current.owner.id,
        payload,
        decideSearchAlertResultSchema.parse({
          status: "completed",
          requestId: payload.requestId,
          decision: "declined",
          channel: "agent_client",
          savedSearchId: payload.savedSearchId,
          scheduleId: null,
          nextRunAt: null,
          decidedAt: now,
          summary: "Job alert activation declined. No schedule was created.",
        }),
        now,
        dependencies,
      );
      await dependencies.activity?.publish({
        ownerId: current.owner.id,
        correlationId: payload.requestId,
        kind: "schedule",
        key: "decide_search_alert",
        status: "completed",
        safeSummary: "Job alert activation declined through the agent client.",
        actorKind: "agent",
        aggregate: { type: "saved_search", version: savedSearch.version },
        occurredAt: now,
        effects: [
          { target: "saved_searches", kind: "refresh" },
          { target: "agent_activity", kind: "announce" },
        ],
      });
      return apiSuccessResponse(result, { requestId: apiRequestId });
    }

    if (endpoint.status === "pending") {
      const verified = await dependencies.identity.identity.completeEmailVerification(
        current.owner.id,
        { challengeId: payload.challengeId, code: input.code },
        now,
      );
      if (verified.endpointId !== payload.endpointId) {
        throw new DomainError({
          code: "CONFLICT",
          message: "Mailbox verification did not match the reviewed delivery destination.",
        });
      }
    }
    const schedule = await dependencies.savedSearches.scheduleAlert(
      current.owner.id,
      {
        savedSearchId: payload.savedSearchId,
        expectedVersion: payload.savedSearchVersion,
        recurrence: payload.recurrence,
        delivery: { channel: "email", endpointId: payload.endpointId },
      },
      now,
    );
    const result = await persistDecision(
      current.owner.id,
      payload,
      decideSearchAlertResultSchema.parse({
        status: "completed",
        requestId: payload.requestId,
        decision: "approved",
        channel: "agent_client",
        savedSearchId: payload.savedSearchId,
        scheduleId: schedule.id,
        nextRunAt: schedule.nextRunAt,
        decidedAt: now,
        summary: "Job alert activated for the reviewed search and destination.",
      }),
      now,
      dependencies,
    );
    await dependencies.activity?.publish({
      ownerId: current.owner.id,
      correlationId: payload.requestId,
      kind: "schedule",
      key: "decide_search_alert",
      status: "completed",
      safeSummary: "Job alert activated after an agent-client decision.",
      actorKind: "agent",
      aggregate: { type: "schedule", version: schedule.version },
      occurredAt: now,
      effects: [
        { target: "saved_searches", kind: "refresh" },
        { target: "agent_activity", kind: "announce" },
      ],
    });
    return apiSuccessResponse(result, { requestId: apiRequestId, status: 201 });
  } catch (error) {
    return apiErrorResponse(error, { requestId: apiRequestId });
  }
}
