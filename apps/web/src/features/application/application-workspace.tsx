"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import {
  applicationDataGrantSummarySchema,
  applicationDelegationSummarySchema,
  applicationAgentSessionResultSchema,
  applicationDraftSchema,
  applicationReceiptSummarySchema,
  applicationReviewSummarySchema,
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
import { applicationAgentState, applicationDisclosure } from "./application-model";
import { publishApplicationWebMcpSurface } from "./webmcp-surface";
import styles from "./application-view.module.css";

const confirmationResultSchema = z.strictObject({
  confirmationId: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
});

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

export function ApplicationWorkspace({ draftId }: Readonly<{ draftId: string }>) {
  const toast = useToast();
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [confirmation, setConfirmation] = useState<ApplicationConfirmationView | null>(null);
  const [agentCredential, setAgentCredential] = useState<AgentCredential | null>(null);
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
    const reloadState = async (signal: AbortSignal, confirmationReady = confirmation !== null) =>
      applicationAgentState(await load(signal), confirmationReady);

    publishApplicationWebMcpSurface({
      fieldKeys: workspace.requirements.map(({ fieldKey }) => fieldKey),
      currentState: () => applicationAgentState(workspace, confirmation !== null),
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
          state: await reloadState(signal),
          request: {
            id: requested.id,
            operations: requested.operations,
            purpose: requested.purpose,
            expiresAt: requested.expiresAt,
          },
        };
      },
      async setAnswer(input, { signal }) {
        const currentCredential = requireCredential();
        const field = workspace.requirements.find(({ fieldKey }) => fieldKey === input.fieldKey);
        if (field === undefined) throw new Error("The application field is unavailable.");
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/answer`,
          applicationDraftSchema,
          {
            method: "POST",
            body: {
              expectedVersion: workspace.draft.version,
              answer: {
                fieldKey: field.fieldKey,
                value: input.value,
                provenance: "agent_suggestion",
                sensitive: field.sensitive,
                acceptedByHuman: false,
              },
            },
            headers: { authorization: `Bearer ${currentCredential.token}` },
            signal,
          },
        );
        return reloadState(signal);
      },
      async validate({ signal }) {
        const currentCredential = requireCredential();
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/validate`,
          applicationDraftSchema,
          {
            method: "POST",
            headers: { authorization: `Bearer ${currentCredential.token}` },
            signal,
          },
        );
        return reloadState(signal);
      },
      async review({ signal }) {
        const currentCredential = requireCredential();
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/review`,
          applicationReviewSummarySchema,
          {
            method: "POST",
            body: { expectedVersion: workspace.draft.version },
            headers: { authorization: `Bearer ${currentCredential.token}` },
            signal,
          },
        );
        return reloadState(signal);
      },
      async requestDataPermission({ signal }) {
        const currentCredential = requireCredential();
        if (workspace.review === null) throw new Error("Lock the review first.");
        const disclosure = applicationDisclosure(workspace);
        const requested = await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/data-grants`,
          applicationDataGrantSummarySchema,
          {
            method: "POST",
            body: {
              recipientId: workspace.recipient.id,
              purpose: workspace.purpose,
              payloadHash: workspace.review.payloadHash,
              categories: disclosure.categories,
              fieldKeys: disclosure.fieldKeys,
              documentIds: [],
              noticeVersion: workspace.noticeVersion,
              legalBasis: workspace.legalBasis,
              requestedTtlSeconds: 900,
            },
            headers: { authorization: `Bearer ${currentCredential.token}` },
            signal,
          },
        );
        return {
          state: await reloadState(signal),
          request: {
            id: requested.id,
            recipient: workspace.recipient.name,
            purpose: workspace.purpose,
            categories: disclosure.categories.map((category) => category.replaceAll("_", " ")),
            fieldKeys: disclosure.fieldKeys.map((fieldKey) => fieldKey.replaceAll("_", " ")),
            noticeVersion: workspace.noticeVersion,
            expiresAt: requested.expiresAt,
          },
        };
      },
      finalConfirmationRequest() {
        if (workspace.review === null) throw new Error("Lock the review first.");
        const disclosure = applicationDisclosure(workspace);
        return {
          id: workspace.review.id,
          recipient: workspace.recipient.name,
          purpose: workspace.purpose,
          categories: disclosure.categories.map((category) => category.replaceAll("_", " ")),
          fieldKeys: disclosure.fieldKeys.map((fieldKey) => fieldKey.replaceAll("_", " ")),
          noticeVersion: workspace.noticeVersion,
        };
      },
      async submit({ signal }) {
        const currentCredential = requireCredential();
        if (workspace.review === null || confirmation === null) {
          throw new Error("A fresh human confirmation is required.");
        }
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}`,
          applicationReceiptSummarySchema,
          {
            method: "POST",
            body: {
              reviewId: workspace.review.id,
              confirmationId: confirmation.confirmationId,
              idempotencyKey: crypto.randomUUID(),
            },
            headers: { authorization: `Bearer ${currentCredential.token}` },
            signal,
          },
        );
        setConfirmation(null);
        return reloadState(signal, false);
      },
    });

    return () => publishApplicationWebMcpSurface(null);
  }, [agentCredential, confirmation, draftId, load, state]);

  async function saveProfile(workspace: ApplicationWorkspaceState): Promise<number> {
    let version = workspace.draft.version;
    for (const field of workspace.requirements) {
      const value = values[field.fieldKey]?.trim() ?? "";
      const previous = workspace.draft.answers.find((answer) => answer.fieldKey === field.fieldKey);
      if (
        displayValue(previous) === value &&
        previous?.acceptedByHuman === true &&
        previous.sensitive === field.sensitive
      ) {
        continue;
      }
      await queryApi(
        `/api/v1/applications/${encodeURIComponent(draftId)}/answer`,
        applicationDraftSchema,
        {
          method: "POST",
          body: {
            expectedVersion: version,
            answer: {
              fieldKey: field.fieldKey,
              value,
              provenance:
                previous?.provenance === "agent_suggestion" ? "agent_suggestion" : "user_entered",
              sensitive: field.sensitive,
              acceptedByHuman: true,
            },
          },
        },
      );
      version += 1;
    }
    return version;
  }

  async function perform(action: ApplicationAction) {
    if (state.kind !== "ready" || busy) return;
    const current = state.workspace;
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
      if (action === "save_profile") {
        await saveProfile(current);
        toast.show({
          title: "Candidate facts saved",
          description: "Your answers are saved on this private draft, marked with who wrote them.",
          tone: "success",
        });
      } else if (action === "validate") {
        await saveProfile(current);
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/validate`,
          applicationDraftSchema,
          { method: "POST" },
        );
      } else if (action === "review") {
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/review`,
          applicationReviewSummarySchema,
          { method: "POST", body: { expectedVersion: current.draft.version } },
        );
      } else if (action === "request_data_grant") {
        if (current.review === null) throw new Error("Lock the review first.");
        const disclosure = applicationDisclosure(current);
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/data-grants`,
          applicationDataGrantSummarySchema,
          {
            method: "POST",
            body: {
              recipientId: current.recipient.id,
              purpose: current.purpose,
              payloadHash: current.review.payloadHash,
              categories: disclosure.categories,
              fieldKeys: disclosure.fieldKeys,
              documentIds: [],
              noticeVersion: current.noticeVersion,
              legalBasis: current.legalBasis,
              requestedTtlSeconds: 1_800,
            },
          },
        );
      } else if (action === "approve_data_grant") {
        if (current.dataGrant === null) throw new Error("A permission request is required.");
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/data-grants/${encodeURIComponent(current.dataGrant.id)}/approve`,
          applicationDataGrantSummarySchema,
          {
            method: "POST",
            body: {
              interaction: {
                channel: "first_party_ui",
                requestId: current.dataGrant.id,
                affirmation: "confirmed",
                evidenceVersion: "agent-interaction-v1",
              },
            },
          },
        );
      } else if (action === "withdraw_data_grant") {
        if (current.dataGrant === null) throw new Error("An active permission is required.");
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/data-grants/${encodeURIComponent(current.dataGrant.id)}`,
          applicationDataGrantSummarySchema,
          { method: "DELETE" },
        );
        setConfirmation(null);
      } else if (action === "approve_delegation") {
        const requested = current.delegationRequests.find(({ status }) => status === "requested");
        if (requested === undefined) throw new Error("Your agent has not asked for access yet.");
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/delegations/${encodeURIComponent(requested.id)}/approve`,
          applicationDelegationSummarySchema,
          { method: "POST" },
        );
      } else if (action === "revoke_delegation") {
        const active = current.delegationRequests.find(({ status }) => status === "active");
        if (active === undefined) throw new Error("Approve your agent's access first.");
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/delegations/${encodeURIComponent(active.id)}`,
          applicationDelegationSummarySchema,
          { method: "DELETE" },
        );
      } else if (action === "request_confirmation") {
        if (current.review === null) throw new Error("Lock the review first.");
        const result = await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/reviews/${encodeURIComponent(current.review.id)}/confirm`,
          confirmationResultSchema,
          {
            method: "POST",
            body: {
              interaction: {
                channel: "first_party_ui",
                requestId: current.review.id,
                affirmation: "confirmed",
                evidenceVersion: "agent-interaction-v1",
              },
            },
          },
        );
        setConfirmation(result);
        toast.show({
          title: "Confirmation ready for five minutes",
          description: "It is bound to this sealed review and can be used only once.",
          tone: "success",
        });
        return;
      } else if (action === "submit" || action === "handoff") {
        if (current.review === null || confirmation === null) {
          throw new Error("A fresh confirmed review is required.");
        }
        await queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}`,
          applicationReceiptSummarySchema,
          {
            method: "POST",
            body: {
              reviewId: current.review.id,
              confirmationId: confirmation.confirmationId,
              idempotencyKey: crypto.randomUUID(),
            },
          },
        );
        setConfirmation(null);
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
      <main className={styles["page"]} id="main-content">
        <section aria-live="polite" className={styles["stagePanel"]}>
          <h1>{state.kind === "loading" ? "Loading your application…" : state.message}</h1>
          {state.kind === "error" ? (
            <Link className={styles["backLink"]} href="/">
              <ArrowLeftIcon aria-hidden="true" /> Return to search
            </Link>
          ) : null}
        </section>
      </main>
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
