"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  applicationDelegationSummarySchema,
  applicationAgentSessionResultSchema,
  applicationDraftSchema,
  applicationSubmissionDecisionReceiptSchema,
  applicationSubmissionReviewRequestSchema,
  applicationWorkspaceSchema,
  jobDetailResultSchema,
  type ApplicationAnswer,
  type ApplicationReceiptSummary,
  type ApplicationWorkspace as ApplicationWorkspaceState,
  type Job,
} from "@jobbbler/contracts";
import { useToast } from "@jobbbler/ui";

import { ApiClientError, queryApi } from "@/lib/query-client";
import { markOwnerSessionStarted } from "@/lib/owner-session-marker";

import {
  ApplicationView,
  type ApplicationAction,
  type ApplicationConfirmationView,
} from "./application-view";
import {
  clearApplicationAgentCredential,
  restoreApplicationAgentCredential,
  storeApplicationAgentCredential,
  type ApplicationAgentCredentialStorage,
} from "./application-agent-credential-vault";
import { persistApplicationField } from "./application-field-persistence";
import { finalizeApplication } from "./application-finalization";
import {
  bindApplicationServerClock,
  createApplicationAgentAuthorization,
  isAgentAssistedApplication,
  mountApplicationExpiryClock,
  type ApplicationAgentCredential,
  type BoundApplicationServerClock,
} from "./application-model";
import { applicationToolReadiness } from "./headless-application-surface";
import type {
  ApplicationSubmissionDecisionOutcome,
  ApplicationSubmissionReviewRequest,
} from "./webmcp-tools";
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

export interface InitialApplicationWorkspace {
  readonly workspace: ApplicationWorkspaceState;
  readonly job: Job;
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

function laterServerTime(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function applicationCredentialStorage(): ApplicationAgentCredentialStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function useApplicationServerClock(
  workspace: ApplicationWorkspaceState | null,
  credentialExpiresAt: string | null,
): Readonly<{
  now: string | null;
  current(): string;
}> {
  const clock = useRef<BoundApplicationServerClock | null>(null);
  const [snapshot, setSnapshot] = useState<Readonly<{
    draftId: string;
    now: string;
  }> | null>(null);

  useEffect(() => {
    if (workspace === null) return;
    const binding = bindApplicationServerClock(clock.current, workspace);
    clock.current = binding;
    const synchronized = binding.clock.now();
    setSnapshot((current) => ({
      draftId: workspace.draft.id,
      now:
        current?.draftId === workspace.draft.id
          ? laterServerTime(current.now, synchronized)
          : synchronized,
    }));
    return mountApplicationExpiryClock({
      workspace,
      clock: binding.clock,
      additionalExpiries: credentialExpiresAt === null ? [] : [credentialExpiresAt],
      onTick: (now) =>
        setSnapshot((current) => ({
          draftId: workspace.draft.id,
          now: current?.draftId === workspace.draft.id ? laterServerTime(current.now, now) : now,
        })),
    });
  }, [credentialExpiresAt, workspace]);

  const fallback = workspace?.serverNow ?? "1970-01-01T00:00:00.000Z";
  const draftId = workspace?.draft.id ?? null;
  const current = useCallback(
    () =>
      laterServerTime(
        clock.current?.draftId === draftId ? clock.current.clock.now() : fallback,
        fallback,
      ),
    [draftId, fallback],
  );
  const now =
    workspace === null
      ? null
      : snapshot?.draftId === workspace.draft.id
        ? laterServerTime(workspace.serverNow, snapshot.now)
        : workspace.serverNow;
  return useMemo(() => ({ now, current }), [current, now]);
}

export function ApplicationWorkspace({
  draftId,
  initial = null,
}: Readonly<{ draftId: string; initial?: InitialApplicationWorkspace | null }>) {
  return <DraftApplicationWorkspace initial={initial} key={draftId} draftId={draftId} />;
}

function DraftApplicationWorkspace({
  draftId,
  initial,
}: Readonly<{ draftId: string; initial: InitialApplicationWorkspace | null }>) {
  const toast = useToast();
  const [state, setState] = useState<ScreenState>(() =>
    initial === null ? { kind: "loading" } : { kind: "ready", ...initial },
  );
  const stateRef = useRef(state);
  const [values, setValues] = useState<Readonly<Record<string, string>>>(() =>
    initial === null ? {} : fieldValues(initial.workspace),
  );
  const [confirmation, setConfirmation] = useState<ApplicationConfirmationView | null>(null);
  const [agentCredential, setAgentCredential] = useState<ApplicationAgentCredential | null>(null);
  const [credentialVaultReady, setCredentialVaultReady] = useState(false);
  const [submissionReview, setSubmissionReview] =
    useState<ApplicationSubmissionReviewRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);
  useEffect(() => {
    if (initial !== null) markOwnerSessionStarted();
  }, [initial]);
  const applicationClock = useApplicationServerClock(
    state.kind === "ready" ? state.workspace : null,
    agentCredential?.expiresAt ?? null,
  );

  const load = useCallback(
    async (signal?: AbortSignal): Promise<ApplicationWorkspaceState> => {
      const workspace = await queryApi(
        `/api/v1/applications/${encodeURIComponent(draftId)}`,
        applicationWorkspaceSchema,
        signal === undefined ? {} : { signal },
      );
      const job =
        workspace.job ??
        (
          await queryApi(
            `/api/v1/jobs/${encodeURIComponent(workspace.draft.jobId)}`,
            jobDetailResultSchema,
            signal === undefined ? {} : { signal },
          )
        ).job;
      const nextState = { kind: "ready", workspace, job } as const;
      stateRef.current = nextState;
      setState(nextState);
      setValues(fieldValues(workspace));
      return workspace;
    },
    [draftId],
  );

  useEffect(() => {
    if (initial !== null) return;
    const controller = new AbortController();
    void load(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ kind: "error", message: errorMessage(error) });
    });
    return () => controller.abort();
  }, [initial, load]);

  useEffect(() => {
    if (confirmation === null) return;
    const remaining = Date.parse(confirmation.expiresAt) - Date.parse(applicationClock.current());
    if (remaining <= 0) {
      setConfirmation(null);
      return;
    }
    const timeout = window.setTimeout(() => setConfirmation(null), remaining);
    return () => window.clearTimeout(timeout);
  }, [applicationClock, confirmation]);

  useEffect(() => {
    if (credentialVaultReady || state.kind !== "ready") return;
    const storage = applicationCredentialStorage();
    setAgentCredential(
      storage === null
        ? null
        : restoreApplicationAgentCredential(storage, draftId, applicationClock.current()),
    );
    setCredentialVaultReady(true);
  }, [applicationClock, credentialVaultReady, draftId, state.kind]);

  useEffect(() => {
    if (!credentialVaultReady || agentCredential === null) return;
    const expire = () => {
      const storage = applicationCredentialStorage();
      if (storage !== null) clearApplicationAgentCredential(storage, draftId);
      setAgentCredential(null);
    };
    const remaining =
      Date.parse(agentCredential.expiresAt) - Date.parse(applicationClock.current());
    if (!Number.isFinite(remaining) || remaining <= 0) {
      expire();
      return;
    }
    const timeout = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timeout);
  }, [agentCredential, applicationClock, credentialVaultReady, draftId]);

  useEffect(() => {
    if (state.kind !== "ready" || !credentialVaultReady) {
      publishApplicationWebMcpSurface(null);
      return;
    }

    const workspace = state.workspace;
    const job = state.job;
    const authorization = createApplicationAgentAuthorization({
      workspace,
      credential: agentCredential,
      currentTime: applicationClock.current,
    });
    const requireCredential = (): ApplicationAgentCredential => {
      const credential = authorization.currentCredential();
      if (credential === null) throw new Error("Request agent authority before continuing.");
      return credential;
    };
    const reloadReadiness = async (
      signal: AbortSignal,
      confirmationReady = confirmation !== null,
    ) => {
      const reloaded = await load(signal);
      const reloadedState = stateRef.current;
      const roleStatus =
        reloaded.job?.status ??
        (reloadedState.kind === "ready" ? reloadedState.job.status : "closed");
      return applicationToolReadiness(reloaded, roleStatus, confirmationReady, reloaded.serverNow);
    };

    publishApplicationWebMcpSurface({
      currentReadiness: () =>
        applicationToolReadiness(
          workspace,
          job.status,
          confirmation !== null,
          applicationClock.current(),
        ),
      allowsAgentSubmission: () => job.applyMode === "internal" && job.status === "open",
      hasAgentCredential: () => authorization.currentCredential() !== null,
      isOperationAuthorized: authorization.isOperationAuthorized,
      async requestAgentAccess(operations, { signal }) {
        let currentCredential = authorization.currentCredential();
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
          const storage = applicationCredentialStorage();
          if (storage !== null) {
            storeApplicationAgentCredential(
              storage,
              draftId,
              currentCredential,
              applicationClock.current(),
            );
          }
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
                affirmation: decision === "withdraw" ? "revoked" : decision,
                evidenceVersion: "agent-interaction-v1",
              },
            },
            signal,
          },
        );
        if (decision === "withdraw") {
          const storage = applicationCredentialStorage();
          if (storage !== null) clearApplicationAgentCredential(storage, draftId);
          setAgentCredential(null);
        }
        setSubmissionReview(null);
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
          submissionReview.expiresAt > applicationClock.current()
          ? submissionReview
          : null;
      },
      async requestSubmissionReview({ signal }) {
        const currentCredential = requireCredential();
        const current =
          submissionReview !== null &&
          submissionReview.draftVersion === workspace.draft.version &&
          submissionReview.expiresAt > applicationClock.current()
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
          submissionReview.expiresAt <= applicationClock.current()
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
          return {
            ...(await reloadReadiness(signal, false)),
            receipt: null,
            receiptHref: null,
          } satisfies ApplicationSubmissionDecisionOutcome;
        }
        const approvedWorkspace = await load(signal);
        const receipt: ApplicationReceiptSummary = await finalizeApplication({
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
        return {
          ...(await reloadReadiness(signal, false)),
          receipt,
          receiptHref: `/apply/${encodeURIComponent(draftId)}`,
        } satisfies ApplicationSubmissionDecisionOutcome;
      },
    });

    return () => publishApplicationWebMcpSurface(null);
  }, [
    agentCredential,
    applicationClock,
    confirmation,
    credentialVaultReady,
    draftId,
    load,
    state,
    submissionReview,
  ]);

  function persistField(fieldKey: string, value: string): void {
    const snapshot = stateRef.current;
    if (
      snapshot.kind !== "ready" ||
      isAgentAssistedApplication(snapshot.workspace, applicationClock.current())
    ) {
      return;
    }
    const currentValue = displayValue(
      snapshot.workspace.draft.answers.find((answer) => answer.fieldKey === fieldKey),
    );
    if (currentValue === value) {
      setSaveState("saved");
      return;
    }

    const revision = ++saveRevision.current;
    setSaveState("saving");
    setActionError(null);
    const operation = saveChain.current.then(async () => {
      const latest = stateRef.current;
      if (
        latest.kind !== "ready" ||
        isAgentAssistedApplication(latest.workspace, applicationClock.current())
      ) {
        return;
      }
      const latestValue = displayValue(
        latest.workspace.draft.answers.find((answer) => answer.fieldKey === fieldKey),
      );
      if (latestValue === value) return;

      const draft = await persistApplicationField({
        workspace: latest.workspace,
        fieldKey,
        value,
        request: queryApi,
      });
      const nextState: ScreenState = {
        ...latest,
        workspace: { ...latest.workspace, draft },
      };
      stateRef.current = nextState;
      setState(nextState);
    });
    saveChain.current = operation.catch(() => undefined);
    void operation.then(
      () => {
        if (saveRevision.current === revision) setSaveState("saved");
      },
      (error: unknown) => {
        if (saveRevision.current === revision) setSaveState("error");
        setActionError(errorMessage(error));
      },
    );
  }

  async function perform(action: ApplicationAction) {
    if (stateRef.current.kind !== "ready" || busy) return;
    const current = stateRef.current.workspace;
    if (isAgentAssistedApplication(current, applicationClock.current())) {
      setActionError("Complete the final submission decision in your agent app.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      if (action === "review_and_submit") {
        await saveChain.current;
        const latest = stateRef.current;
        if (latest.kind !== "ready") return;
        await finalizeApplication({
          workspace: latest.workspace,
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
      const message = errorMessage(error);
      if (action === "review_and_submit") {
        try {
          await load();
        } catch {
          // Keep the original finalization failure visible. A later page reload can recover.
        }
      }
      setActionError(message);
    } finally {
      setBusy(false);
    }
  }

  if (state.kind !== "ready") {
    return (
      <div className={styles["page"]}>
        {state.kind === "loading" ? (
          <section
            aria-label="Loading your application"
            className={styles["stagePanel"]}
            role="status"
          >
            <div className={styles["skeleton"]}>
              <span className={styles["skeletonTitle"]} />
              <span className={styles["skeletonLine"]} />
              <span className={styles["skeletonLine"]} />
              <span className={styles["skeletonLineShort"]} />
            </div>
            <span className="sr-only">Loading your application.</span>
          </section>
        ) : (
          <section aria-live="polite" className={styles["stagePanel"]}>
            <h1>{state.message}</h1>
            <Link className={styles["backLink"]} href="/jobs">
              <ArrowLeftIcon aria-hidden="true" /> Return to search
            </Link>
          </section>
        )}
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
      now={applicationClock.now ?? state.workspace.serverNow}
      saveState={saveState}
      onAction={(action) => void perform(action)}
      onFieldChange={(fieldKey, value) => {
        if (!isAgentAssistedApplication(state.workspace, applicationClock.current())) {
          setValues((current) => ({ ...current, [fieldKey]: value }));
        }
      }}
      onFieldCommit={persistField}
      workspace={state.workspace}
    />
  );
}
