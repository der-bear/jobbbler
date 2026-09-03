import type { ZodType } from "zod";

import {
  applicationAgentSessionResultSchema,
  applicationDelegationSummarySchema,
  applicationDraftSchema,
  applicationSubmissionDecisionReceiptSchema,
  applicationSubmissionReviewRequestSchema,
  applicationWorkspaceSchema,
  jobDetailResultSchema,
  type ApplicationAnswer,
  type ApplicationReceiptSummary,
  type ApplicationWorkspace,
  type Job,
} from "@jobbbler/contracts";

import { ApiClientError, type QueryApiOptions } from "@/lib/query-client";

import {
  clearApplicationAgentCredential,
  restoreApplicationAgentCredential,
  storeApplicationAgentCredential,
  type ApplicationAgentCredentialStorage,
} from "./application-agent-credential-vault";
import { finalizeApplication } from "./application-finalization";
import {
  applicationAgentState,
  applicationNextAction,
  applicationReadiness,
  createApplicationAgentAuthorization,
  createServerDerivedApplicationClock,
  type ApplicationAgentCredential,
} from "./application-model";
import type {
  ApplicationSubmissionDecisionOutcome,
  ApplicationSubmissionReviewRequest,
  ApplicationToolDependencies,
  ApplicationToolReadiness,
} from "./webmcp-tools";

type ApplicationRequest = <T>(
  url: string,
  schema: ZodType<T>,
  options?: QueryApiOptions,
) => Promise<T>;

export interface HeadlessApplicationSurfaceStoreDependencies {
  readonly request: ApplicationRequest;
  readonly storage?: ApplicationAgentCredentialStorage | null;
  readonly randomUUID?: () => string;
}

export interface ResolvedHeadlessApplicationSurface {
  readonly readiness: ApplicationToolReadiness;
  readonly surface: ApplicationToolDependencies;
}

export interface HeadlessApplicationSurfaceStore {
  resolve(
    draftId: string,
    options: Readonly<{
      signal: AbortSignal;
      visibleSurface?: ApplicationToolDependencies | null;
    }>,
  ): Promise<ResolvedHeadlessApplicationSurface | null>;
}

function displayValue(answer: ApplicationAnswer | undefined): string {
  if (answer?.value === null || answer?.value === undefined) return "";
  if (Array.isArray(answer.value)) return answer.value.join(", ");
  return String(answer.value);
}

function fieldValues(workspace: ApplicationWorkspace): Record<string, string> {
  return Object.fromEntries(
    workspace.requirements.map((field) => [
      field.fieldKey,
      displayValue(workspace.draft.answers.find((answer) => answer.fieldKey === field.fieldKey)),
    ]),
  );
}

export function applicationToolReadiness(
  workspace: ApplicationWorkspace,
  roleStatus: Job["status"],
  finalConfirmationReady = false,
  now = workspace.serverNow,
): ApplicationToolReadiness {
  const progress = applicationReadiness(workspace);
  return {
    state: applicationAgentState(workspace, finalConfirmationReady, now, roleStatus),
    roleStatus,
    missingFieldKeys: progress.missingFieldKeys,
    missingFieldLabels: progress.missingFieldKeys.map(
      (fieldKey) =>
        workspace.requirements.find((field) => field.fieldKey === fieldKey)?.label ?? fieldKey,
    ),
    nextAction: applicationNextAction(workspace, now, finalConfirmationReady, roleStatus),
  };
}

async function loadWorkspace(
  draftId: string,
  request: ApplicationRequest,
  signal: AbortSignal,
): Promise<Readonly<{ workspace: ApplicationWorkspace; job: Job }> | null> {
  try {
    const workspace = await request(
      `/api/v1/applications/${encodeURIComponent(draftId)}`,
      applicationWorkspaceSchema,
      { signal },
    );
    const job =
      workspace.job ??
      (
        await request(
          `/api/v1/jobs/${encodeURIComponent(workspace.draft.jobId)}`,
          jobDetailResultSchema,
          { signal },
        )
      ).job;
    return { workspace, job };
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

interface HeadlessSurfaceController {
  readonly surface: ApplicationToolDependencies;
  reload(signal: AbortSignal): Promise<void>;
}

function createController(
  draftId: string,
  initial: Readonly<{ workspace: ApplicationWorkspace; job: Job }>,
  dependencies: Required<
    Pick<HeadlessApplicationSurfaceStoreDependencies, "request" | "randomUUID">
  > &
    Readonly<{ storage: ApplicationAgentCredentialStorage | null }>,
): HeadlessSurfaceController {
  let workspace = initial.workspace;
  let job = initial.job;
  const clock = createServerDerivedApplicationClock(workspace.serverNow);
  let credential: ApplicationAgentCredential | null =
    dependencies.storage === null
      ? null
      : restoreApplicationAgentCredential(dependencies.storage, draftId, clock.now());
  let submissionReview: ApplicationSubmissionReviewRequest | null = null;

  const currentReview = (): ApplicationSubmissionReviewRequest | null => {
    if (
      submissionReview === null ||
      submissionReview.draftVersion !== workspace.draft.version ||
      Date.parse(submissionReview.expiresAt) <= Date.parse(clock.now())
    ) {
      submissionReview = null;
    }
    return submissionReview;
  };

  const readiness = (): ApplicationToolReadiness =>
    applicationToolReadiness(workspace, job.status, currentReview() !== null, clock.now());

  const authorization = () =>
    createApplicationAgentAuthorization({
      workspace,
      credential,
      currentTime: clock.now,
    });

  const requireCredential = (): ApplicationAgentCredential => {
    const current = authorization().currentCredential();
    if (current !== null) return current;
    if (dependencies.storage !== null) {
      clearApplicationAgentCredential(dependencies.storage, draftId);
    }
    credential = null;
    throw new Error("Request agent authority before continuing.");
  };

  const reload = async (signal: AbortSignal): Promise<void> => {
    const loaded = await loadWorkspace(draftId, dependencies.request, signal);
    if (loaded === null) {
      throw new ApiClientError({
        code: "NOT_FOUND",
        message: "That owner-accessible application could not be found.",
        retryable: false,
      });
    }
    workspace = loaded.workspace;
    job = loaded.job;
    clock.synchronize(workspace.serverNow);
  };

  const surface: ApplicationToolDependencies = {
    currentReadiness: readiness,
    allowsAgentSubmission: () => job.applyMode === "internal" && job.status === "open",
    hasAgentCredential: () => authorization().currentCredential() !== null,
    isOperationAuthorized: (operation) => authorization().isOperationAuthorized(operation),
    async requestAgentAccess(operations, { signal }) {
      let currentCredential = authorization().currentCredential();
      if (currentCredential === null) {
        currentCredential = await dependencies.request(
          `/api/v1/applications/${encodeURIComponent(draftId)}/agent-sessions`,
          applicationAgentSessionResultSchema,
          {
            method: "POST",
            body: { requestedTtlSeconds: 900 },
            signal,
          },
        );
        credential = currentCredential;
        if (dependencies.storage !== null) {
          storeApplicationAgentCredential(
            dependencies.storage,
            draftId,
            currentCredential,
            clock.now(),
          );
        }
      }
      const requested = await dependencies.request(
        `/api/v1/applications/${encodeURIComponent(draftId)}/delegations`,
        applicationDelegationSummarySchema,
        {
          method: "POST",
          body: {
            operations,
            purpose:
              "Prepare this application with the candidate using only the current stage's named operations.",
            requestedTtlSeconds: 900,
          },
          headers: { authorization: `Bearer ${currentCredential.token}` },
          signal,
        },
      );
      await reload(signal);
      return {
        state: readiness().state,
        request: {
          id: requested.id,
          operations: requested.operations,
          purpose: requested.purpose,
          expiresAt: requested.expiresAt,
        },
      };
    },
    async decideAgentAccess(requestId, decision, { signal, channel }) {
      const requested = workspace.delegationRequests.find(({ id }) => id === requestId);
      const expectedStatus = decision === "withdraw" ? "active" : "requested";
      if (requested === undefined || requested.status !== expectedStatus) {
        throw new ApiClientError({
          code: "CONFLICT",
          message:
            decision === "withdraw"
              ? "That exact assistance request is not active. Check application readiness for the current authority state."
              : "That assistance request is no longer pending. Check application readiness for the current next step.",
          retryable: false,
        });
      }
      await dependencies.request(
        `/api/v1/applications/${encodeURIComponent(draftId)}/delegations/${encodeURIComponent(requestId)}${
          decision === "approved" ? "/approve" : ""
        }`,
        applicationDelegationSummarySchema,
        {
          method: decision === "approved" ? "POST" : "DELETE",
          body: {
            interaction: {
              channel,
              requestId,
              affirmation: decision === "withdraw" ? "revoked" : decision,
              evidenceVersion: "agent-interaction-v1",
            },
          },
          signal,
        },
      );
      if (decision === "withdraw") {
        if (dependencies.storage !== null) {
          clearApplicationAgentCredential(dependencies.storage, draftId);
        }
        credential = null;
      }
      submissionReview = null;
      await reload(signal);
      return { state: readiness().state, decision };
    },
    async proposeUpdates(patches, { signal }) {
      const currentCredential = requireCredential();
      submissionReview = null;
      const answers = patches.map((patch) => {
        const field = workspace.requirements.find(({ fieldKey }) => fieldKey === patch.fieldKey);
        if (field === undefined) {
          throw new ApiClientError({
            code: "VALIDATION",
            message: `Unknown application field: ${patch.fieldKey}.`,
            retryable: false,
          });
        }
        return {
          fieldKey: field.fieldKey,
          value: patch.value,
          provenance: "agent_suggestion" as const,
          sensitive: field.sensitive,
          acceptedByHuman: false,
        };
      });
      await dependencies.request(
        `/api/v1/applications/${encodeURIComponent(draftId)}/answer`,
        applicationDraftSchema,
        {
          method: "POST",
          body: { expectedVersion: workspace.draft.version, answers },
          headers: { authorization: `Bearer ${currentCredential.token}` },
          signal,
        },
      );
      await reload(signal);
      return readiness();
    },
    currentSubmissionReview: currentReview,
    async requestSubmissionReview({ signal }) {
      const currentCredential = requireCredential();
      const current = currentReview();
      if (current !== null) return current;
      const serverRequest = await dependencies.request(
        `/api/v1/applications/${encodeURIComponent(draftId)}/consent`,
        applicationSubmissionReviewRequestSchema,
        {
          method: "POST",
          headers: { authorization: `Bearer ${currentCredential.token}` },
          signal,
        },
      );
      submissionReview = {
        ...serverRequest,
        href: `/apply/${encodeURIComponent(draftId)}`,
      };
      return submissionReview;
    },
    async decideSubmission(expectedVersion, decision, { signal, channel }) {
      const currentCredential = requireCredential();
      const review = currentReview();
      if (workspace.draft.version !== expectedVersion || review === null) {
        throw new ApiClientError({
          code: "CONFLICT",
          message: "The application changed after the review request. Ask for a fresh review.",
          retryable: false,
        });
      }
      await dependencies.request(
        `/api/v1/applications/${encodeURIComponent(draftId)}/consent/${encodeURIComponent(review.id)}`,
        applicationSubmissionDecisionReceiptSchema,
        {
          method: "POST",
          body: {
            expectedVersion,
            decision,
            interaction: {
              channel,
              requestId: review.id,
              affirmation: decision,
              evidenceVersion: "agent-interaction-v1",
            },
          },
          signal,
        },
      );
      if (decision === "declined") {
        submissionReview = null;
        await reload(signal);
        return {
          ...readiness(),
          receipt: null,
          receiptHref: null,
        } satisfies ApplicationSubmissionDecisionOutcome;
      }
      await reload(signal);
      const receipt: ApplicationReceiptSummary = await finalizeApplication({
        workspace,
        values: fieldValues(workspace),
        request: dependencies.request,
        idempotencyKey: dependencies.randomUUID(),
        interactionChannel: channel,
        interactionRequestId: review.id,
        agentAuthorization: `Bearer ${currentCredential.token}`,
        signal,
      });
      submissionReview = null;
      await reload(signal);
      return {
        ...readiness(),
        receipt,
        receiptHref: `/apply/${encodeURIComponent(draftId)}`,
      } satisfies ApplicationSubmissionDecisionOutcome;
    },
  };

  return { surface, reload };
}

export function createHeadlessApplicationSurfaceStore(
  dependencies: HeadlessApplicationSurfaceStoreDependencies,
): HeadlessApplicationSurfaceStore {
  const controllers = new Map<string, HeadlessSurfaceController>();
  const resolvedDependencies = {
    request: dependencies.request,
    storage: dependencies.storage ?? null,
    randomUUID: dependencies.randomUUID ?? (() => crypto.randomUUID()),
  };

  return {
    async resolve(draftId, { signal, visibleSurface }) {
      const visibleReadiness = visibleSurface?.currentReadiness();
      if (
        visibleSurface !== null &&
        visibleSurface !== undefined &&
        visibleReadiness?.state.draftId === draftId
      ) {
        controllers.delete(draftId);
        return {
          readiness: visibleReadiness,
          surface: visibleSurface,
        };
      }

      const current = controllers.get(draftId);
      if (current !== undefined) {
        try {
          await current.reload(signal);
          return { readiness: current.surface.currentReadiness(), surface: current.surface };
        } catch (error) {
          if (error instanceof ApiClientError && error.code === "NOT_FOUND") {
            controllers.delete(draftId);
            return null;
          }
          throw error;
        }
      }

      const loaded = await loadWorkspace(draftId, dependencies.request, signal);
      if (loaded === null) return null;
      const controller = createController(draftId, loaded, resolvedDependencies);
      controllers.set(draftId, controller);
      return {
        readiness: controller.surface.currentReadiness(),
        surface: controller.surface,
      };
    },
  };
}
