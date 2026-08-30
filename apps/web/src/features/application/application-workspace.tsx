"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  applicationDelegationSummarySchema,
  applicationAgentSessionResultSchema,
  applicationDraftSchema,
  applicationSubmissionDecisionReceiptSchema,
  applicationSubmissionReviewRequestSchema,
  applicationWorkspaceSchema,
  jobDetailResultSchema,
  type ApplicationAnswer,
  type AgentOperation,
  type ApplicationWorkspace as ApplicationWorkspaceState,
  type Job,
} from "@jobbbler/contracts";
import { useToast } from "@jobbbler/ui";

import { ApiClientError, queryApi } from "@/lib/query-client";

import {
  ApplicationView,
  type ApplicationAction,
  type ApplicationConfirmationView,
} from "./application-view";
import { finalizeApplication } from "./application-finalization";
import {
  applicationAgentState,
  applicationNextAction,
  applicationReadiness,
  isAgentAssistedApplication,
} from "./application-model";
import type { ApplicationSubmissionReviewRequest, ApplicationToolReadiness } from "./webmcp-tools";
import { publishApplicationWebMcpSurface } from "./webmcp-surface";
import styles from "./application-view.module.css";

type ScreenState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly workspace: ApplicationWorkspaceState;
      readonly job: Job;
    }
  | { readonly kind: "error"; readonly message: string };

interface AgentCredential {
  readonly sessionId: string;
  readonly token: string;
  readonly expiresAt: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "The application workspace could not be updated. Your last confirmed state is unchanged.";
}

function displayValue(answer: ApplicationAnswer | undefined): string {
  if (answer?.value === null || answer?.value === undefined) return "";
  if (Array.isArray(answer.value)) return answer.value.join(", ");
  return String(answer.value);
}

function fieldValues(workspace: ApplicationWorkspaceState): Record<string, string> {
  return Object.fromEntries(
    workspace.requirements.map((field) => [
      field.fieldKey,
      displayValue(workspace.draft.answers.find((answer) => answer.fieldKey === field.fieldKey)),
    ]),
  );
}

function toolReadiness(
  workspace: ApplicationWorkspaceState,
  finalConfirmationReady = false,
): ApplicationToolReadiness {
  const progress = applicationReadiness(workspace);
  const state = applicationAgentState(workspace, finalConfirmationReady);
  return {
    state,
    missingFieldKeys: progress.missingFieldKeys,
    missingFieldLabels: progress.missingFieldKeys.map(
      (fieldKey) =>
        workspace.requirements.find((field) => field.fieldKey === fieldKey)?.label ?? fieldKey,
    ),
    nextAction: applicationNextAction(workspace, finalConfirmationReady),
  };
}

export function ApplicationWorkspace({ draftId }: Readonly<{ draftId: string }>) {
  const toast = useToast();
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [confirmation, setConfirmation] = useState<ApplicationConfirmationView | null>(null);
  const [agentCredential, setAgentCredential] = useState<AgentCredential | null>(null);
  const [submissionReview, setSubmissionReview] =
    useState<ApplicationSubmissionReviewRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<ApplicationWorkspaceState> => {
      const workspace = await queryApi(
        `/api/v1/applications/${encodeURIComponent(draftId)}`,
        applicationWorkspaceSchema,
        signal === undefined ? {} : { signal },
      );
      const detail = await queryApi(
        `/api/v1/jobs/${encodeURIComponent(workspace.draft.jobId)}`,
        jobDetailResultSchema,
        signal === undefined ? {} : { signal },
      );
      setState({ kind: "ready", workspace, job: detail.job });
      setValues(fieldValues(workspace));
      return workspace;
    },
    [draftId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ kind: "error", message: errorMessage(error) });
    });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (confirmation === null) return;
    const remaining = Date.parse(confirmation.expiresAt) - Date.now();
    if (remaining <= 0) {
      setConfirmation(null);
      return;
    }
    const timeout = window.setTimeout(() => setConfirmation(null), remaining);
    return () => window.clearTimeout(timeout);
  }, [confirmation]);

  useEffect(() => {
    if (state.kind !== "ready") {
      publishApplicationWebMcpSurface(null);
      return;
    }

    const workspace = state.workspace;
    const job = state.job;
    const credential =
      agentCredential !== null && agentCredential.expiresAt > new Date().toISOString()
        ? agentCredential
        : null;
    const authorizedOperations = new Set<AgentOperation>(
      credential === null
        ? []
        : workspace.delegationRequests
            .filter(
              (delegation) =>
                delegation.agentSessionId === credential.sessionId &&
                delegation.status === "active" &&
                delegation.expiresAt > new Date().toISOString(),
            )
            .flatMap(({ operations }) => operations),
    );
    const requireCredential = (): AgentCredential => {
      if (credential === null) throw new Error("Request agent authority before continuing.");
      return credential;
    };
    const reloadReadiness = async (
      signal: AbortSignal,
      confirmationReady = confirmation !== null,
    ) => toolReadiness(await load(signal), confirmationReady);

    publishApplicationWebMcpSurface({
      currentReadiness: () => toolReadiness(workspace, confirmation !== null),
      allowsAgentSubmission: () => job.applyMode === "internal",
      hasAgentCredential: () => credential !== null,
      isOperationAuthorized: (operation) => authorizedOperations.has(operation),
      async requestAgentAccess(operations, { signal }) {
        let currentCredential = credential;
        if (currentCredential === null) {
          currentCredential = await queryApi(
            `/api/v1/applications/${encodeURIComponent(draftId)}/agent-sessions`,
            applicationAgentSessionResultSchema,
            {
              method: "POST",
              body: { requestedTtlSeconds: 900 },
              signal,
            },
          );
          setAgentCredential(currentCredential);
        }
        const requested = await queryApi(
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
        return {
          state: (await reloadReadiness(signal)).state,
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
        if (requested === undefined || requested.status !== "requested") {
          throw new ApiClientError({
            code: "CONFLICT",
            message:
              "That assistance request is no longer pending. Check application readiness for the current next step.",
            retryable: false,
          });
        }
        await queryApi(
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
                affirmation: decision,
                evidenceVersion: "agent-interaction-v1",
              },
            },
            signal,
          },
        );
        return {
          state: (await reloadReadiness(signal)).state,
          decision,
        };
      },
      async proposeUpdates(patches, { signal }) {
        const currentCredential = requireCredential();
        setSubmissionReview(null);
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
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/answer`,
          applicationDraftSchema,
          {
            method: "POST",
            body: { expectedVersion: workspace.draft.version, answers },
            headers: { authorization: `Bearer ${currentCredential.token}` },
            signal,
          },
        );
        return reloadReadiness(signal);
      },
      currentSubmissionReview() {
        return submissionReview !== null &&
          submissionReview.draftVersion === workspace.draft.version &&
          submissionReview.expiresAt > new Date().toISOString()
          ? submissionReview
          : null;
      },
      async requestSubmissionReview({ signal }) {
        const currentCredential = requireCredential();
        const current =
          submissionReview !== null &&
          submissionReview.draftVersion === workspace.draft.version &&
          submissionReview.expiresAt > new Date().toISOString()
            ? submissionReview
            : null;
        if (current !== null) return current;
        const serverRequest = await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/consent`,
          applicationSubmissionReviewRequestSchema,
          {
            method: "POST",
            headers: { authorization: `Bearer ${currentCredential.token}` },
            signal,
          },
        );
        const requested: ApplicationSubmissionReviewRequest = {
          ...serverRequest,
          href: `/apply/${encodeURIComponent(workspace.draft.id)}`,
        };
        setSubmissionReview(requested);
        return requested;
      },
      async decideSubmission(expectedVersion, decision, { signal, channel }) {
        const currentCredential = requireCredential();
        if (workspace.draft.version !== expectedVersion) {
          throw new ApiClientError({
            code: "CONFLICT",
            message: "The application changed after the review request. Ask for a fresh review.",
            retryable: false,
          });
        }
        if (
          submissionReview === null ||
          submissionReview.draftVersion !== expectedVersion ||
          submissionReview.expiresAt <= new Date().toISOString()
        ) {
          throw new ApiClientError({
            code: "CONFLICT",
            message: "The submission review is no longer current. Ask for a fresh review.",
            retryable: false,
          });
        }
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/consent/${encodeURIComponent(submissionReview.id)}`,
          applicationSubmissionDecisionReceiptSchema,
          {
            method: "POST",
            body: {
              expectedVersion,
              decision,
              interaction: {
                channel,
                requestId: submissionReview.id,
                affirmation: decision,
                evidenceVersion: "agent-interaction-v1",
              },
            },
            signal,
          },
        );
        if (decision === "declined") {
          setSubmissionReview(null);
          return reloadReadiness(signal, false);
        }
        const approvedWorkspace = await load(signal);
        await finalizeApplication({
          workspace: approvedWorkspace,
          values: fieldValues(approvedWorkspace),
          request: queryApi,
          idempotencyKey: crypto.randomUUID(),
          interactionChannel: channel,
          interactionRequestId: submissionReview.id,
          agentAuthorization: `Bearer ${currentCredential.token}`,
          signal,
        });
        setSubmissionReview(null);
        return reloadReadiness(signal, false);
      },
    });

    return () => publishApplicationWebMcpSurface(null);
  }, [agentCredential, confirmation, draftId, load, state, submissionReview]);

  async function perform(action: ApplicationAction) {
    if (state.kind !== "ready" || busy) return;
    const current = state.workspace;
    if (action === "review_and_submit" && isAgentAssistedApplication(current)) {
      setActionError(
        "Complete the exact submission decision in your external agent client for this agent-assisted draft.",
      );
      return;
    }
    if (action === "use_demo_profile") {
      setValues((existing) => ({
        ...existing,
        full_name: "Alex Morgan",
        email: "alex.morgan@example.com",
        location: "Kyiv, Ukraine",
        portfolio_url: "https://example.com/alex-morgan",
        motivation:
          "I build calm, accessible product workflows and enjoy turning complex systems into tools people can trust.",
        work_authorization: "Authorized to work in the European Union",
      }));
      toast.show({
        title: "Synthetic demo profile loaded",
        description: "All values are fictional and remain local to this draft until you save them.",
        tone: "info",
      });
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      if (action === "review_and_submit") {
        await finalizeApplication({
          workspace: current,
          values,
          request: queryApi,
          idempotencyKey: crypto.randomUUID(),
        });
        setConfirmation(null);
        toast.show({
          title: "Application submitted",
          description: `The exact reviewed application was sent to ${current.recipient.name}.`,
          tone: "success",
        });
      }
      await load();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (state.kind !== "ready") {
    return (
      <div className={styles["page"]}>
        <section aria-live="polite" className={styles["stagePanel"]}>
          <h1>{state.kind === "loading" ? "Loading your application…" : state.message}</h1>
          {state.kind === "error" ? (
            <Link className={styles["backLink"]} href="/jobs">
              <ArrowLeftIcon aria-hidden="true" /> Return to search
            </Link>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <ApplicationView
      busy={busy}
      confirmation={confirmation}
      error={actionError}
      fieldValues={values}
      job={state.job}
      onAction={(action) => void perform(action)}
      onFieldChange={(fieldKey, value) =>
        setValues((current) => ({ ...current, [fieldKey]: value }))
      }
      workspace={state.workspace}
    />
  );
}
