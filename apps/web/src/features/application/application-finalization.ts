import { z, type ZodType } from "zod";

import {
  applicationDataGrantSummarySchema,
  applicationDraftSchema,
  applicationReceiptSummarySchema,
  applicationReviewSummarySchema,
  type ApplicationReceiptSummary,
  type ApplicationReviewSummary,
  type ApplicationWorkspace,
} from "@jobbbler/contracts";

import type { QueryApiOptions } from "@/lib/query-client";

const confirmationResultSchema = z.strictObject({
  confirmationId: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
});

type ApplicationRequest = <T>(
  url: string,
  schema: ZodType<T>,
  options?: QueryApiOptions,
) => Promise<T>;

function interaction(requestId: string, channel: "first_party_ui" | "agent_client") {
  return {
    channel,
    requestId,
    affirmation: "confirmed" as const,
    evidenceVersion: "agent-interaction-v1",
  };
}

export async function finalizeApplication(
  input: Readonly<{
    workspace: ApplicationWorkspace;
    values: Readonly<Record<string, string>>;
    request: ApplicationRequest;
    idempotencyKey: string;
    interactionChannel?: "first_party_ui" | "agent_client";
    interactionRequestId?: string;
    agentAuthorization?: string;
    signal?: AbortSignal;
  }>,
): Promise<ApplicationReceiptSummary> {
  const {
    workspace,
    values,
    request,
    idempotencyKey,
    interactionChannel = "first_party_ui",
    interactionRequestId,
    agentAuthorization,
    signal,
  } = input;
  if (interactionChannel === "agent_client" && interactionRequestId === undefined) {
    throw new Error("The agent-client review request is required before submission.");
  }
  if (interactionChannel === "agent_client" && agentAuthorization === undefined) {
    throw new Error("The scoped application agent credential is required before submission.");
  }
  const requestOptions = signal === undefined ? {} : { signal };
  const actorRequestOptions = {
    ...requestOptions,
    ...(agentAuthorization === undefined ? {} : { headers: { authorization: agentAuthorization } }),
  };
  let draft = workspace.draft;
  let review: ApplicationReviewSummary | null =
    workspace.review?.status === "active" && workspace.review.draftVersion === draft.version
      ? workspace.review
      : null;

  const answers = workspace.requirements.flatMap((field) => {
    const value = values[field.fieldKey]?.trim() ?? "";
    if (field.required && value.length === 0) {
      throw new Error(`${field.label} is required before submission.`);
    }
    const previous = draft.answers.find((answer) => answer.fieldKey === field.fieldKey);
    if (value.length === 0 && previous === undefined) return [];
    const previousValue = Array.isArray(previous?.value)
      ? previous.value.join(", ")
      : previous?.value === null || previous?.value === undefined
        ? ""
        : String(previous.value);
    if (
      previousValue === value &&
      previous?.acceptedByHuman === true &&
      previous.sensitive === field.sensitive
    ) {
      return [];
    }
    return [
      {
        fieldKey: field.fieldKey,
        value,
        provenance:
          previous?.provenance === "agent_suggestion" ? "agent_suggestion" : "user_entered",
        sensitive: field.sensitive,
        acceptedByHuman: true,
      },
    ];
  });

  if (answers.length > 0) {
    draft = await request(
      `/api/v1/applications/${encodeURIComponent(draft.id)}/answer`,
      applicationDraftSchema,
      {
        method: "POST",
        body: {
          expectedVersion: draft.version,
          answers,
        },
        ...actorRequestOptions,
      },
    );
    review = null;
  }

  if (draft.state === "draft") {
    draft = await request(
      `/api/v1/applications/${encodeURIComponent(draft.id)}/validate`,
      applicationDraftSchema,
      { method: "POST", ...actorRequestOptions },
    );
  }
  if (draft.state === "valid") {
    review = await request(
      `/api/v1/applications/${encodeURIComponent(draft.id)}/review`,
      applicationReviewSummarySchema,
      {
        method: "POST",
        body: { expectedVersion: draft.version },
        ...actorRequestOptions,
      },
    );
  }
  if (review === null) {
    throw new Error("The application changed before its final review. Please try again.");
  }

  const includedFields = workspace.requirements.filter(
    (field) => (values[field.fieldKey]?.trim() ?? "").length > 0,
  );
  let grant = workspace.dataGrant;
  if (
    grant?.status === "requested" &&
    (grant.decisionChannel !== interactionChannel ||
      grant.decisionRequestId !==
        (interactionChannel === "agent_client" ? interactionRequestId : grant.id))
  ) {
    await request(
      `/api/v1/applications/${encodeURIComponent(draft.id)}/data-grants/${encodeURIComponent(grant.id)}`,
      applicationDataGrantSummarySchema,
      { method: "DELETE", ...requestOptions },
    );
    grant = null;
  }
  if (grant?.status !== "active" && grant?.status !== "requested") {
    grant = await request(
      `/api/v1/applications/${encodeURIComponent(draft.id)}/data-grants`,
      applicationDataGrantSummarySchema,
      {
        method: "POST",
        body: {
          recipientId: workspace.recipient.id,
          purpose: workspace.purpose,
          payloadHash: review.payloadHash,
          categories: [...new Set(includedFields.map(({ category }) => category))],
          fieldKeys: includedFields.map(({ fieldKey }) => fieldKey),
          documentIds: [],
          noticeVersion: workspace.noticeVersion,
          legalBasis: workspace.legalBasis,
          ...(interactionChannel === "agent_client"
            ? { consentRequestId: interactionRequestId }
            : {}),
          requestedTtlSeconds: 1_800,
        },
        ...actorRequestOptions,
      },
    );
  }
  if (grant.status !== "active") {
    await request(
      `/api/v1/applications/${encodeURIComponent(draft.id)}/data-grants/${encodeURIComponent(grant.id)}/approve`,
      applicationDataGrantSummarySchema,
      {
        method: "POST",
        body: {
          interaction: interaction(
            interactionChannel === "agent_client" ? interactionRequestId! : grant.id,
            interactionChannel,
          ),
        },
        ...requestOptions,
      },
    );
  }

  const confirmation = await request(
    `/api/v1/applications/${encodeURIComponent(draft.id)}/reviews/${encodeURIComponent(review.id)}/confirm`,
    confirmationResultSchema,
    {
      method: "POST",
      ...actorRequestOptions,
    },
  );
  return request(
    `/api/v1/applications/${encodeURIComponent(draft.id)}`,
    applicationReceiptSummarySchema,
    {
      method: "POST",
      body: {
        reviewId: review.id,
        confirmationId: confirmation.confirmationId,
        idempotencyKey,
      },
      ...actorRequestOptions,
    },
  );
}
