import { DomainError, type createSavedSearchService } from "@jobbbler/core-domain";
import type {
  AlertChangeRecord,
  AlertDeliveryRecord,
  AlertEvaluationRecord,
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

const MAX_LATEST_RUN_CHANGES = 25;

async function privateMutation(
  request: Request,
  dependencies: SavedSearchRouteDependencies,
): Promise<{ readonly ownerId: string; readonly body: unknown }> {
  assertTrustedMutationOrigin(request, dependencies.identity.environment);
  const current = await requireOwnerSession(request, dependencies.identity);
  return { ownerId: current.owner.id, body: await readSmallJsonBody(request) };
}

export async function handleCreateSavedSearchRequest(
  request: Request,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const command = await privateMutation(request, dependencies);
    const now = dependencies.identity.now();
    const saved = await dependencies.service.createSavedSearch(command.ownerId, command.body, now);
    await dependencies.activity?.publish({
      ownerId: command.ownerId,
      correlationId: requestId,
      kind: "saved_search",
      key: "save_job_search",
      status: "completed",
      safeSummary: "Job search saved to the private workspace.",
      actorKind: "human",
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

export async function handleSetScheduleEnabledRequest(
  request: Request,
  routeContext: ScheduleRouteContext,
  dependencies: SavedSearchRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const command = await privateMutation(request, dependencies);
    const { scheduleId } = await routeContext.params;
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
      actorKind: "human",
      aggregate: { type: "schedule", version: schedule.version },
      occurredAt: now,
      effects: [
        { target: "saved_searches", kind: "refresh" },
        { target: "agent_activity", kind: "announce" },
      ],
    });
    return apiSuccessResponse(schedule, { requestId });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}
