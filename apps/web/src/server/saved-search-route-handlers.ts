import { createHash } from "node:crypto";
import { z } from "zod";

import { savedSearchDeletionReceiptSchema } from "@jobbbler/contracts";
import { DomainError, isDomainError, type createSavedSearchService } from "@jobbbler/core-domain";
import type {
  AlertChangeRecord,
  AlertDeliveryRecord,
  AlertEvaluationRecord,
  IdempotencyRepository,
} from "@jobbbler/storage";

import { apiErrorResponse, apiSuccessResponse } from "./api-response";
import { createRequestId } from "./context";
import type { IdentityRouteDependencies } from "./identity-route-handlers";
import { readSmallJsonBody, requireOwnerSession } from "./identity-route-handlers";
import { assertTrustedMutationOrigin } from "./identity-security";
import type { OwnerActivityPublisher } from "./owner-activity-publisher";

export type SavedSearchOperations = ReturnType<typeof createSavedSearchService>;

export interface SavedSearchRouteDependencies {
  readonly identity: IdentityRouteDependencies;
  readonly service: SavedSearchOperations;
  readonly idempotency: Pick<IdempotencyRepository, "get" | "putIfAbsent">;
  readonly latestRun?: {
    readonly getEvaluation: (savedSearchId: string) => Promise<AlertEvaluationRecord | null>;
    readonly listChanges: (evaluationId: string) => Promise<readonly AlertChangeRecord[]>;
    readonly getLatestDelivery: (scheduleId: string) => Promise<AlertDeliveryRecord | null>;
  };
  readonly activity?: OwnerActivityPublisher;
}

export interface ScheduleRouteContext {
  readonly params: Promise<{ readonly scheduleId: string }>;
}

export interface LatestRunRouteContext {
  readonly params: Promise<{ readonly savedSearchId: string }>;
}

export interface SavedSearchRouteContext {
  readonly params: Promise<{ readonly savedSearchId: string }>;
}

const MAX_LATEST_RUN_CHANGES = 25;
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const IDEMPOTENCY_RECORD_TTL_MS = 24 * 60 * 60 * 1_000;
const SAVED_SEARCH_DELETE_CONFIRMATION = "DELETE_SAVED_SEARCH_AND_ALERT" as const;
const agentDeleteSavedSearchInputSchema = z.strictObject({
  confirmation: z.literal(SAVED_SEARCH_DELETE_CONFIRMATION),
});

function readIdempotencyKey(request: Request): string | null {
  const header = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (header === null) return null;
  const key = header.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new DomainError({
      code: "VALIDATION",
      message: "Idempotency-Key must be 1-128 characters of letters, digits, '_', '.', ':' or '-'.",
    });
  }
  return key;
}

function requireIdempotencyKey(request: Request): string {
  const key = readIdempotencyKey(request);
  if (key === null) {
    throw new DomainError({
      code: "VALIDATION",
      message: "Idempotency-Key is required for this action.",
    });
  }
  return key;
}

function savedSearchCreateRequestHash(body: unknown): string {
  return createHash("sha256")
    .update("jobbbler:saved-search-create:v1\u0000")
    .update(JSON.stringify(body) ?? "")
    .digest("hex");
}

function savedSearchDeleteRequestHash(savedSearchId: string): string {
  return createHash("sha256")
    .update("jobbbler:saved-search-delete:v1\u0000")
    .update(savedSearchId)
    .update("\u0000")
    .update(SAVED_SEARCH_DELETE_CONFIRMATION)
    .digest("hex");
}

async function privateMutation(
  request: Request,
  dependencies: SavedSearchRouteDependencies,
): Promise<{ readonly ownerId: string; readonly body: unknown }> {
  assertTrustedMutationOrigin(request, dependencies.identity.environment);
  const current = await requireOwnerSession(request, dependencies.identity);
  return { ownerId: current.owner.id, body: await readSmallJsonBody(request) };
}

async function handleCreateSavedSearchRequestForActor(
  request: Request,
  dependencies: SavedSearchRouteDependencies,
  actorKind: "human" | "agent",
  idempotencyRequired: boolean,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const command = await privateMutation(request, dependencies);
    const idempotencyKey = idempotencyRequired
      ? requireIdempotencyKey(request)
      : readIdempotencyKey(request);
    const scope = `saved_search.create:${command.ownerId}`;
    const now = dependencies.identity.now();
    if (idempotencyKey !== null) {
      const replay = await dependencies.idempotency.get(scope, idempotencyKey);
      if (replay !== null) {
        if (replay.requestHash !== savedSearchCreateRequestHash(command.body)) {
          throw new DomainError({
            code: "CONFLICT",
            message: "The idempotency key is already bound to a different request.",
          });
        }
        return apiSuccessResponse(replay.responseBody, {
          requestId,
          status: replay.responseStatus,
        });
      }
    }
    const saved = await dependencies.service.createSavedSearch(command.ownerId, command.body, now);
    if (idempotencyKey !== null) {
      let put;
      try {
        put = await dependencies.idempotency.putIfAbsent({
          scope,
          key: idempotencyKey,
          requestHash: savedSearchCreateRequestHash(command.body),
          responseStatus: 201,
          responseBody: saved,
          createdAt: now,
          expiresAt: new Date(Date.parse(now) + IDEMPOTENCY_RECORD_TTL_MS).toISOString(),
        });
      } catch (error) {
        await dependencies.service.deleteSavedSearch(command.ownerId, saved.id);
        throw error;
      }
      if (!put.inserted) {
        await dependencies.service.deleteSavedSearch(command.ownerId, saved.id);
        return apiSuccessResponse(put.record.responseBody, {
          requestId,
          status: put.record.responseStatus,
        });
      }
    }
    await dependencies.activity?.publish({
      ownerId: command.ownerId,
      correlationId: requestId,
      kind: "saved_search",
      key: "save_job_search",
      status: "completed",
      safeSummary: "Job search saved to the private workspace.",
      actorKind,
      aggregate: { type: "saved_search", version: saved.version },
      occurredAt: now,
      effects: [
        { target: "saved_searches", kind: "refresh" },
        { target: "agent_activity", kind: "announce" },
      ],
    });
    return apiSuccessResponse(saved, { requestId, status: 201 });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export function handleCreateSavedSearchRequest(
  request: Request,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  return handleCreateSavedSearchRequestForActor(request, dependencies, "human", false);
}

export function handleAgentCreateSavedSearchRequest(
  request: Request,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  return handleCreateSavedSearchRequestForActor(request, dependencies, "agent", true);
}

export async function handleListSavedSearchesRequest(
  request: Request,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const current = await requireOwnerSession(request, dependencies.identity);
    return apiSuccessResponse(await dependencies.service.listSavedSearches(current.owner.id), {
      requestId,
    });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleGetLatestSavedSearchRunRequest(
  request: Request,
  routeContext: LatestRunRouteContext,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const current = await requireOwnerSession(request, dependencies.identity);
    const { savedSearchId } = await routeContext.params;
    const savedSearch = (await dependencies.service.listSavedSearches(current.owner.id)).find(
      (candidate) => candidate.id === savedSearchId,
    );
    if (savedSearch === undefined) {
      throw new DomainError({ code: "NOT_FOUND", message: "Saved search was not found." });
    }
    const schedule = (await dependencies.service.listSchedules(current.owner.id)).find(
      (candidate) => candidate.savedSearchId === savedSearch.id,
    );
    if (schedule === undefined) {
      return apiSuccessResponse({ savedSearchId, evaluation: null, delivery: null }, { requestId });
    }
    const latestRun = dependencies.latestRun;
    if (latestRun === undefined) {
      throw new DomainError({
        code: "DEPENDENCY",
        message: "Latest alert state is unavailable.",
        retryable: true,
      });
    }
    const evaluation = await latestRun.getEvaluation(savedSearch.id);
    const delivery = await latestRun.getLatestDelivery(schedule.id);
    if (
      evaluation !== null &&
      (evaluation.ownerId !== current.owner.id ||
        evaluation.savedSearchId !== savedSearch.id ||
        evaluation.scheduleId !== schedule.id)
    ) {
      throw new DomainError({
        code: "CONFLICT",
        message: "Latest alert evaluation has an invalid owner binding.",
      });
    }
    if (
      delivery !== null &&
      (delivery.ownerId !== current.owner.id || delivery.scheduleId !== schedule.id)
    ) {
      throw new DomainError({
        code: "CONFLICT",
        message: "Latest alert delivery has an invalid owner binding.",
      });
    }
    const changes = evaluation === null ? [] : await latestRun.listChanges(evaluation.id);
    return apiSuccessResponse(
      {
        savedSearchId,
        evaluation:
          evaluation === null
            ? null
            : {
                id: evaluation.id,
                createdAt: evaluation.createdAt,
                catalogUpdatedAt: evaluation.catalogUpdatedAt,
                baselineCount: evaluation.baseline.length,
                changes: {
                  total: changes.length,
                  truncated: changes.length > MAX_LATEST_RUN_CHANGES,
                  items: changes.slice(0, MAX_LATEST_RUN_CHANGES).map((change) => ({
                    id: change.id,
                    jobId: change.jobId,
                    kind: change.kind,
                    createdAt: change.createdAt,
                  })),
                },
              },
        delivery:
          delivery === null
            ? null
            : {
                status: delivery.status,
                attempt: delivery.attempt,
                errorCode: delivery.errorCode,
                acceptedAt: delivery.acceptedAt,
                lastAttemptAt: delivery.lastAttemptAt,
                updatedAt: delivery.updatedAt,
              },
      },
      { requestId },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handlePreviewScheduleRequest(
  request: Request,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const command = await privateMutation(request, dependencies);
    return apiSuccessResponse(
      await dependencies.service.previewSchedule(
        command.ownerId,
        command.body,
        dependencies.identity.now(),
      ),
      { requestId },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleCreateScheduleRequest(
  request: Request,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const command = await privateMutation(request, dependencies);
    const now = dependencies.identity.now();
    const schedule = await dependencies.service.scheduleAlert(command.ownerId, command.body, now);
    await dependencies.activity?.publish({
      ownerId: command.ownerId,
      correlationId: requestId,
      kind: "schedule",
      key: "activate_job_alert",
      status: "completed",
      safeSummary: "Verified job alert activated.",
      actorKind: "human",
      aggregate: { type: "schedule", version: schedule.version },
      occurredAt: now,
      effects: [
        { target: "saved_searches", kind: "refresh" },
        { target: "agent_activity", kind: "announce" },
      ],
    });
    return apiSuccessResponse(schedule, { requestId, status: 201 });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleListSchedulesRequest(
  request: Request,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const current = await requireOwnerSession(request, dependencies.identity);
    return apiSuccessResponse(await dependencies.service.listSchedules(current.owner.id), {
      requestId,
    });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

interface ScheduleMutationCommand {
  readonly ownerId: string;
  readonly body: unknown;
}

async function respondWithScheduleEnabled(
  command: ScheduleMutationCommand,
  scheduleId: string,
  dependencies: SavedSearchRouteDependencies,
  requestId: string,
  actorKind: "agent" | "human",
): Promise<Response> {
  const now = dependencies.identity.now();
  const schedule = await dependencies.service.setScheduleEnabled(
    command.ownerId,
    scheduleId,
    command.body,
    now,
  );
  await dependencies.activity?.publish({
    ownerId: command.ownerId,
    correlationId: requestId,
    kind: "schedule",
    key: "set_job_alert_state",
    status: "completed",
    safeSummary: schedule.enabled ? "Job alert resumed." : "Job alert paused.",
    actorKind,
    aggregate: { type: "schedule", version: schedule.version },
    occurredAt: now,
    effects: [
      { target: "saved_searches", kind: "refresh" },
      { target: "agent_activity", kind: "announce" },
    ],
  });
  return apiSuccessResponse(schedule, { requestId });
}

async function respondWithScheduleUpdate(
  command: ScheduleMutationCommand,
  scheduleId: string,
  dependencies: SavedSearchRouteDependencies,
  requestId: string,
): Promise<Response> {
  const now = dependencies.identity.now();
  const schedule = await dependencies.service.updateSchedule(
    command.ownerId,
    scheduleId,
    command.body,
    now,
  );
  await dependencies.activity?.publish({
    ownerId: command.ownerId,
    correlationId: requestId,
    kind: "schedule",
    key: "update_job_alert",
    status: "completed",
    safeSummary: "Job alert schedule updated.",
    actorKind: "human",
    aggregate: { type: "schedule", version: schedule.version },
    occurredAt: now,
    effects: [
      { target: "saved_searches", kind: "refresh" },
      { target: "agent_activity", kind: "announce" },
    ],
  });
  return apiSuccessResponse(schedule, { requestId });
}

export async function handleSetScheduleEnabledRequest(
  request: Request,
  routeContext: ScheduleRouteContext,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const command = await privateMutation(request, dependencies);
    const { scheduleId } = await routeContext.params;
    return await respondWithScheduleEnabled(command, scheduleId, dependencies, requestId, "human");
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleAgentSetScheduleEnabledRequest(
  request: Request,
  routeContext: ScheduleRouteContext,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const command = await privateMutation(request, dependencies);
    const { scheduleId } = await routeContext.params;
    return await respondWithScheduleEnabled(command, scheduleId, dependencies, requestId, "agent");
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleUpdateScheduleRequest(
  request: Request,
  routeContext: ScheduleRouteContext,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const command = await privateMutation(request, dependencies);
    const { scheduleId } = await routeContext.params;
    const togglesEnabled =
      typeof command.body === "object" && command.body !== null && "enabled" in command.body;
    return await (togglesEnabled
      ? respondWithScheduleEnabled(command, scheduleId, dependencies, requestId, "human")
      : respondWithScheduleUpdate(command, scheduleId, dependencies, requestId));
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

async function deleteSavedSearchAndPublish(
  ownerId: string,
  savedSearchId: string,
  dependencies: SavedSearchRouteDependencies,
  requestId: string,
  actorKind: "agent" | "human",
) {
  const now = dependencies.identity.now();
  const removed = await dependencies.service.deleteSavedSearch(ownerId, savedSearchId);
  const receipt = savedSearchDeletionReceiptSchema.parse({
    savedSearchId: removed.savedSearch.id,
    scheduleId: removed.schedule === null ? null : removed.schedule.id,
    deleted: true,
  });
  await dependencies.activity?.publish({
    ownerId,
    correlationId: requestId,
    kind: "saved_search",
    key: "delete_saved_search",
    status: "completed",
    safeSummary:
      removed.schedule === null
        ? "Saved search removed from the private workspace."
        : "Saved search and its job alert were removed.",
    actorKind,
    aggregate: { type: "saved_search", version: removed.savedSearch.version },
    occurredAt: now,
    effects: [
      { target: "saved_searches", kind: "refresh" },
      { target: "agent_activity", kind: "announce" },
    ],
  });
  return receipt;
}

async function prepareSavedSearchDeletionReceipt(
  ownerId: string,
  savedSearchId: string,
  dependencies: SavedSearchRouteDependencies,
) {
  const [savedSearches, schedules] = await Promise.all([
    dependencies.service.listSavedSearches(ownerId),
    dependencies.service.listSchedules(ownerId),
  ]);
  const savedSearch = savedSearches.find(({ id }) => id === savedSearchId);
  if (savedSearch === undefined) {
    throw new DomainError({ code: "NOT_FOUND", message: "Saved search was not found." });
  }
  const schedule = schedules.find((candidate) => candidate.savedSearchId === savedSearch.id);
  return savedSearchDeletionReceiptSchema.parse({
    savedSearchId: savedSearch.id,
    scheduleId: schedule?.id ?? null,
    deleted: true,
  });
}

export async function handleDeleteSavedSearchRequest(
  request: Request,
  routeContext: SavedSearchRouteContext,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.identity.environment);
    const current = await requireOwnerSession(request, dependencies.identity);
    const { savedSearchId } = await routeContext.params;
    const receipt = await deleteSavedSearchAndPublish(
      current.owner.id,
      savedSearchId,
      dependencies,
      requestId,
      "human",
    );
    return apiSuccessResponse(receipt, { requestId });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleAgentDeleteSavedSearchRequest(
  request: Request,
  routeContext: SavedSearchRouteContext,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const command = await privateMutation(request, dependencies);
    agentDeleteSavedSearchInputSchema.parse(command.body);
    const { savedSearchId } = await routeContext.params;
    const idempotencyKey = requireIdempotencyKey(request);
    const scope = `saved_search.delete:${command.ownerId}`;
    const requestHash = savedSearchDeleteRequestHash(savedSearchId);
    let claim = await dependencies.idempotency.get(scope, idempotencyKey);
    if (claim === null) {
      const receipt = await prepareSavedSearchDeletionReceipt(
        command.ownerId,
        savedSearchId,
        dependencies,
      );
      const now = dependencies.identity.now();
      const put = await dependencies.idempotency.putIfAbsent({
        scope,
        key: idempotencyKey,
        requestHash,
        responseStatus: 200,
        responseBody: receipt,
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + IDEMPOTENCY_RECORD_TTL_MS).toISOString(),
      });
      claim = put.record;
    }
    if (claim.requestHash !== requestHash) {
      throw new DomainError({
        code: "CONFLICT",
        message: "The idempotency key is already bound to a different request.",
      });
    }
    const receipt = savedSearchDeletionReceiptSchema.parse(claim.responseBody);
    try {
      await deleteSavedSearchAndPublish(
        command.ownerId,
        savedSearchId,
        dependencies,
        requestId,
        "agent",
      );
    } catch (error) {
      if (!isDomainError(error) || error.code !== "NOT_FOUND") throw error;
    }
    return apiSuccessResponse(receipt, {
      requestId,
      status: claim.responseStatus,
    });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}
