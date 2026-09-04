import { z } from "zod";

import {
  applicationConsentWithdrawalSchema,
  entityIdSchema,
  type AgentOperation,
  type ApplicationAgentState,
  type ApplicationConsentWithdrawal,
  type ApplicationReceiptSummary,
  type ApplicationSubmissionReviewRequest as ApplicationSubmissionReviewContract,
  type Job,
} from "@jobbbler/contracts";
import type { ApplicationNextAction } from "./application-model";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import {
  completedWebMcpResult,
  failedWebMcpResult,
  requiresUserActionWebMcpResult,
  safeWebMcpErrorResult,
  type CompletedWebMcpResult,
  type RequiresUserActionWebMcpResult,
  type SafeWebMcpErrorResult,
} from "@/lib/webmcp-tool-result";
import {
  buildSubmissionReviewPresentation,
  MAX_APPLICATION_SUBMISSION_REVIEW_RESULT_BYTES,
} from "./submission-review-presentation";

const emptyInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const satisfies JsonSchema;

const patchesProperty = {
  type: "array",
  description:
    "Answers from known facts only. For cover_letter, use get_job_details and local CV facts; send only the letter. Ask; never invent missing facts.",
  minItems: 1,
  maxItems: 24,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      fieldKey: {
        type: "string",
        description: "A field key reported by get_application_readiness.",
        maxLength: 64,
      },
      value: {
        type: "string",
        description:
          "A truthful answer written from supplied facts. A cover_letter should be complete and role-specific, not a generic motivation sentence.",
        maxLength: 10_000,
      },
    },
    required: ["fieldKey", "value"],
  },
} as const satisfies JsonSchema;

const patchesInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { patches: patchesProperty },
  required: ["patches"],
} as const satisfies JsonSchema;

const assistanceDecisionProperty = {
  type: "string",
  description: "The person's explicit decision in the agent client.",
  enum: ["approved", "declined", "withdraw"],
} as const satisfies JsonSchema;

const submissionDecisionProperty = {
  type: "string",
  description: "The person's explicit decision in the agent client.",
  enum: ["approved", "declined"],
} as const satisfies JsonSchema;

const assistanceDecisionInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    requestId: {
      type: "string",
      description: "The server-issued assistance request ID.",
      pattern: "^delegation_[0-9a-f-]{36}$",
    },
    decision: assistanceDecisionProperty,
  },
  required: ["requestId", "decision"],
} as const satisfies JsonSchema;

const submissionDecisionInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    requestId: {
      type: "string",
      description: "The review request ID returned by request_submission_review.",
      maxLength: 128,
    },
    draftVersion: {
      type: "integer",
      description: "The exact draft version returned with the review request.",
      minimum: 0,
    },
    decision: submissionDecisionProperty,
  },
  required: ["requestId", "draftVersion", "decision"],
} as const satisfies JsonSchema;

const emptyInput = z.strictObject({});
const assistanceDecision = z.enum(["approved", "declined", "withdraw"]);
const submissionDecision = z.enum(["approved", "declined"]);
const assistanceDecisionInput = z.strictObject({
  requestId: entityIdSchema.refine((value) => value.startsWith("delegation_"), {
    message: "Expected the server-issued assistance request ID.",
  }),
  decision: assistanceDecision,
});
const submissionDecisionInput = z.strictObject({
  requestId: z.string().max(128),
  draftVersion: z.number().int().nonnegative(),
  decision: submissionDecision,
});
const patchesInput = z
  .strictObject({
    patches: z
      .array(
        z.strictObject({
          fieldKey: z.string().max(64),
          value: z.string().max(10_000),
        }),
      )
      .min(1)
      .max(24),
  })
  .superRefine(({ patches }, context) => {
    const seen = new Set<string>();
    for (const [index, patch] of patches.entries()) {
      if (seen.has(patch.fieldKey)) {
        context.addIssue({
          code: "custom",
          path: ["patches", index, "fieldKey"],
          message: "Each application field may appear only once per update.",
        });
      }
      seen.add(patch.fieldKey);
    }
  });

type ApplicationToolOutput =
  CompletedWebMcpResult<JsonValue> | RequiresUserActionWebMcpResult | SafeWebMcpErrorResult;

export interface ApplicationToolReadiness {
  readonly state: ApplicationAgentState;
  readonly roleStatus: Job["status"];
  readonly missingFieldKeys: readonly string[];
  readonly missingFieldLabels: readonly string[];
  readonly nextAction: ApplicationNextAction;
}

export type ApplicationSubmissionReviewRequest = ApplicationSubmissionReviewContract & {
  readonly href: string;
};

export interface ApplicationToolDependencies {
  currentReadiness(): ApplicationToolReadiness;
  allowsAgentSubmission(): boolean;
  hasAgentCredential(): boolean;
  isOperationAuthorized(operation: AgentOperation): boolean;
  requestAgentAccess(
    operations: readonly AgentOperation[],
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<{
    readonly state: ApplicationAgentState;
    readonly request: {
      readonly id: string;
      readonly operations: readonly AgentOperation[];
      readonly purpose: string;
      readonly expiresAt: string;
    };
  }>;
  decideAgentAccess(
    requestId: string,
    decision: "approved" | "declined" | "withdraw",
    options: Readonly<{ signal: AbortSignal; channel: "agent_client" }>,
  ): Promise<{
    readonly state: ApplicationAgentState;
    readonly decision: "approved" | "declined" | "withdraw";
  }>;
  proposeUpdates(
    patches: readonly Readonly<{ fieldKey: string; value: string }>[],
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<ApplicationToolReadiness>;
  currentSubmissionReview(): ApplicationSubmissionReviewRequest | null;
  requestSubmissionReview(
    options: Readonly<{
      signal: AbortSignal;
    }>,
  ): ApplicationSubmissionReviewRequest | Promise<ApplicationSubmissionReviewRequest>;
  decideSubmission(
    expectedVersion: number,
    decision: "approved" | "declined",
    options: Readonly<{ signal: AbortSignal; channel: "agent_client" }>,
  ): Promise<ApplicationSubmissionDecisionOutcome>;
}

export interface ApplicationSubmissionDecisionOutcome extends ApplicationToolReadiness {
  readonly receipt: ApplicationReceiptSummary | null;
  readonly receiptHref: string | null;
}

function safeReadiness(readiness: ApplicationToolReadiness): Readonly<Record<string, JsonValue>> {
  const { state } = readiness;
  return {
    draftId: state.draftId,
    jobId: state.jobId,
    applyMode: state.applyMode,
    state: state.state,
    stage: state.stage,
    roleStatus: readiness.roleStatus,
    version: state.version,
    requiredFields: state.requiredFields,
    completedRequiredFields: state.completedRequiredFields,
    missingCount: readiness.missingFieldKeys.length,
    missingFieldKeys: readiness.missingFieldKeys,
    missingFieldLabels: readiness.missingFieldLabels,
    nextAction: readiness.nextAction,
    nextTool: nextApplicationTool(readiness),
    finalConfirmationReady: state.finalConfirmationReady,
    receiptStatus: state.receiptStatus,
  };
}

function nextApplicationTool(readiness: ApplicationToolReadiness): string | null {
  const { state } = readiness;
  if (state.stage === "closed") {
    return readiness.nextAction === "withdraw" ? "withdraw_application_consent" : null;
  }
  if (readiness.nextAction === "withdraw") return "withdraw_application_consent";
  if (readiness.nextAction === "read_only" || readiness.nextAction === "complete") return null;
  if (state.agentAuthorityStatus === "requested") return "decide_application_assistance";
  if (state.agentAuthorityStatus !== "active") return "request_application_assistance";
  if (readiness.missingFieldKeys.length > 0) return "propose_application_updates";
  return state.finalConfirmationReady
    ? "decide_application_submission"
    : "request_submission_review";
}

function completed(summary: string, readiness: ApplicationToolReadiness): ApplicationToolOutput {
  return completedWebMcpResult({
    summary: readiness.state.stage === "closed" ? "Role closed — nothing submitted." : summary,
    data: safeReadiness(readiness),
    resources: [{ type: "application", id: readiness.state.draftId, label: "Private application" }],
    facts: [
      { key: "missing_required_fields", value: readiness.missingFieldKeys.length },
      { key: "next_action", value: readiness.nextAction },
    ],
  });
}

function completedSubmissionDecision(
  summary: string,
  outcome: ApplicationSubmissionDecisionOutcome,
): ApplicationToolOutput {
  return completedWebMcpResult({
    summary,
    data: {
      ...safeReadiness(outcome),
      ...(outcome.receipt === null || outcome.receiptHref === null
        ? {}
        : {
            receipt: {
              id: outcome.receipt.id,
              status: outcome.receipt.status,
              createdAt: outcome.receipt.createdAt,
              href: outcome.receiptHref,
            },
          }),
    },
    resources: [{ type: "application", id: outcome.state.draftId, label: "Private application" }],
    facts: [
      { key: "missing_required_fields", value: outcome.missingFieldKeys.length },
      { key: "next_action", value: outcome.nextAction },
    ],
  });
}

function hasPreparationAuthority(dependencies: ApplicationToolDependencies): boolean {
  return (
    dependencies.hasAgentCredential() &&
    dependencies.isOperationAuthorized("read_application") &&
    dependencies.isOperationAuthorized("edit_application")
  );
}

function assistanceOperations(allowsAgentSubmission: boolean): readonly AgentOperation[] {
  const preparation: readonly AgentOperation[] = [
    "read_application",
    "edit_application",
    "validate_application",
    "review_application",
    "request_data_consent",
    "request_confirmation",
  ];
  return allowsAgentSubmission ? [...preparation, "submit_application"] : preparation;
}

function readinessTool(
  dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "get_application_readiness",
    purpose: "Check what this application still needs, without reading private answers.",
    description:
      "Return completion counts, missing field keys and labels, the safe workflow state, and the next useful action. It never returns candidate answers, contact details, credentials, or tokens.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        return completed(
          "Checked what this application needs next.",
          dependencies.currentReadiness(),
        );
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Application readiness accepts no arguments.");
      }
    },
  };
}

function assistanceTool(
  dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "request_application_assistance",
    purpose:
      "Take short-lived permission to prepare this private application; no question is asked.",
    description:
      "The person's request to apply is the authority to prepare. This call grants application-bound, short-lived assistance at once and returns propose_application_updates as the next step; it asks the person nothing. Nothing is sent to an employer until the person approves the exact completed application.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        /*
         * Two consents made every agent stop twice per application. The person
         * already said "apply"; preparing answers in a private draft shares
         * nothing and sends nothing, so it needs no second yes. The decision
         * that matters — the exact application and its recipient — stays.
         */
        const { request } = await dependencies.requestAgentAccess(
          assistanceOperations(dependencies.allowsAgentSubmission()),
          { signal },
        );
        const result = await dependencies.decideAgentAccess(request.id, "approved", {
          signal,
          channel: "agent_client",
        });
        return completedWebMcpResult({
          summary:
            "Preparation is allowed for this application. Nothing is sent until the person approves the exact application.",
          data: {
            draftId: result.state.draftId,
            requestId: request.id,
            agentAuthorityStatus: result.state.agentAuthorityStatus,
            expiresAt: request.expiresAt,
            nextTool: "propose_application_updates",
          },
          resources: [
            { type: "application", id: result.state.draftId, label: "Private application" },
          ],
          facts: [{ key: "expires", value: request.expiresAt }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Application assistance accepts no arguments.");
      }
    },
  };
}

function assistanceDecisionTool(
  dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "decide_application_assistance",
    purpose: "Withdraw or revoke assistance for this application when the person asks.",
    description:
      "Assistance is granted automatically by request_application_assistance; call this only when the person asks to stop the agent's help: pass that requestId with withdraw (or declined) to revoke active assistance bound to it; it never shares data or submits an application.",
    inputSchema: assistanceDecisionInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = assistanceDecisionInput.parse(input);
        const result = await dependencies.decideAgentAccess(parsed.requestId, parsed.decision, {
          signal,
          channel: "agent_client",
        });
        return completedWebMcpResult({
          summary:
            result.decision === "approved"
              ? "Recorded the decision and enabled short-lived application assistance."
              : result.decision === "withdraw"
                ? "Withdrew the request-bound application assistance."
                : "Recorded the decision and kept application assistance off.",
          data: {
            draftId: result.state.draftId,
            decision: result.decision,
            agentAuthorityStatus: result.state.agentAuthorityStatus,
            nextTool:
              result.decision === "approved"
                ? "get_application_readiness"
                : result.decision === "withdraw"
                  ? "request_application_assistance"
                  : null,
          },
          resources: [
            { type: "application", id: result.state.draftId, label: "Private application" },
          ],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide the exact assistance request ID and the person's decision.",
        );
      }
    },
  };
}

function updatesTool(
  dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "propose_application_updates",
    purpose: "Prepare several application answers at once from facts the person supplied.",
    description:
      "Update up to 24 distinct fields in one bounded call. For cover_letter, combine the full role description with CV facts available locally to the agent, but send Jobbbler only the finished letter. Ask for every missing fact once, in a single message, and skip optional fields the person never mentioned. Never invent sensitive information or upload the CV.",
    inputSchema: patchesInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const { patches } = patchesInput.parse(input);
        const result = await dependencies.proposeUpdates(patches, { signal });
        return completed("Prepared the application updates for review.", result);
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide one to 24 distinct application fields without extra properties.",
        );
      }
    },
  };
}

function submissionReviewTool(
  dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "request_submission_review",
    purpose: "Ask the person to review and approve one exact completed application.",
    description:
      "Freeze the exact application and return its exact field values to the already-authorized agent client for the final review. Present every value, recipient, purpose, privacy notice, version, and expiry before asking for the decision. The review link is an optional browser fallback; this call submits nothing.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        const request = await dependencies.requestSubmissionReview({ signal });
        const reviewPresentation = buildSubmissionReviewPresentation(request);
        return requiresUserActionWebMcpResult({
          summary:
            "The completed application is ready for the person's final review in the agent client.",
          kind: "action_confirmation",
          surface: "application_review",
          requestId: request.id,
          nextTool: "decide_application_submission",
          decisionContext: reviewPresentation.decisionContext,
          presentation: reviewPresentation.presentation,
          maximumBytes: MAX_APPLICATION_SUBMISSION_REVIEW_RESULT_BYTES,
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Submission review accepts no arguments.");
      }
    },
  };
}

function submissionDecisionTool(
  dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "decide_application_submission",
    purpose: "Record the person's exact submission decision from the agent client.",
    description:
      "Use the exact requestId and draftVersion returned by request_submission_review plus the person's explicit decision. Never approve on the person's behalf. On approval, record disclosure consent, seal the unchanged payload, submit once, and return a receipt; on decline, share and submit nothing.",
    inputSchema: submissionDecisionInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = submissionDecisionInput.parse(input);
        const request = dependencies.currentSubmissionReview();
        const current = dependencies.currentReadiness();
        if (
          request === null ||
          parsed.requestId !== request.id ||
          parsed.draftVersion !== current.state.version
        ) {
          return failedWebMcpResult({
            code: "CONFLICT",
            message: "The application changed after the review request. Ask for a fresh review.",
            retryable: false,
          });
        }
        const outcome = await dependencies.decideSubmission(parsed.draftVersion, parsed.decision, {
          signal,
          channel: "agent_client",
        });
        return completedSubmissionDecision(
          parsed.decision === "approved"
            ? "Recorded consent, submitted the approved application, and saved its receipt."
            : "Declined. No data was shared and nothing was submitted.",
          outcome,
        );
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide the exact review request, draft version, and the person's decision.",
        );
      }
    },
  };
}

export function createApplicationToolManifests(
  dependencies: ApplicationToolDependencies,
): readonly ToolManifest<unknown, ApplicationToolOutput>[] {
  const readiness = dependencies.currentReadiness();
  const tools: ToolManifest<unknown, ApplicationToolOutput>[] = [readinessTool(dependencies)];
  if (readiness.state.stage === "closed" || readiness.roleStatus !== "open") return tools;
  if (readiness.state.applyMode === "external" || readiness.nextAction === "complete") {
    if (
      readiness.state.agentAuthorityStatus === "requested" ||
      readiness.state.agentAuthorityStatus === "active"
    ) {
      tools.push(assistanceDecisionTool(dependencies));
    }
    return tools;
  }

  if (!hasPreparationAuthority(dependencies)) {
    tools.push(
      readiness.state.agentAuthorityStatus === "requested" ||
        readiness.state.agentAuthorityStatus === "active"
        ? assistanceDecisionTool(dependencies)
        : assistanceTool(dependencies),
    );
    return tools;
  }

  tools.push(updatesTool(dependencies));
  if (readiness.missingFieldKeys.length > 0) {
    if (readiness.state.agentAuthorityStatus === "active") {
      tools.push(assistanceDecisionTool(dependencies));
    }
    return tools;
  }

  const pendingReview = dependencies.currentSubmissionReview();
  if (
    pendingReview !== null &&
    dependencies.allowsAgentSubmission() &&
    dependencies.isOperationAuthorized("submit_application")
  ) {
    tools.push(submissionDecisionTool(dependencies));
  } else {
    tools.push(submissionReviewTool(dependencies));
  }
  if (readiness.state.agentAuthorityStatus === "active") {
    tools.push(assistanceDecisionTool(dependencies));
  }
  return tools;
}

const draftIdProperty = {
  type: "string",
  description: "An application ID returned by prepare_application.",
  pattern: "^application_[0-9a-f-]{36}$",
} as const satisfies JsonSchema;

const stableDraftInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { draftId: draftIdProperty },
  required: ["draftId"],
} as const satisfies JsonSchema;

const stablePatchesInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { draftId: draftIdProperty, patches: patchesProperty },
  required: ["draftId", "patches"],
} as const satisfies JsonSchema;

const stableAssistanceDecisionInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    draftId: draftIdProperty,
    ...assistanceDecisionInputSchema.properties,
  },
  required: ["draftId", "requestId", "decision"],
} as const satisfies JsonSchema;

const stableSubmissionDecisionInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    draftId: draftIdProperty,
    ...submissionDecisionInputSchema.properties,
  },
  required: ["draftId", "requestId", "draftVersion", "decision"],
} as const satisfies JsonSchema;

const stableDraftInput = z.strictObject({
  draftId: entityIdSchema.refine((value) => value.startsWith("application_"), {
    message: "Expected an application ID returned by prepare_application.",
  }),
});
const stablePatchesInput = stableDraftInput
  .extend({ patches: patchesInput.shape.patches })
  .superRefine(({ patches }, context) => {
    const seen = new Set<string>();
    for (const [index, patch] of patches.entries()) {
      if (seen.has(patch.fieldKey)) {
        context.addIssue({
          code: "custom",
          path: ["patches", index, "fieldKey"],
          message: "Each application field may appear only once per update.",
        });
      }
      seen.add(patch.fieldKey);
    }
  });
const stableAssistanceDecisionInput = stableDraftInput.extend(assistanceDecisionInput.shape);
const stableSubmissionDecisionInput = stableDraftInput.extend(submissionDecisionInput.shape);

interface StableApplicationToolDefinition {
  readonly name:
    | "get_application_readiness"
    | "request_application_assistance"
    | "decide_application_assistance"
    | "propose_application_updates"
    | "request_submission_review"
    | "decide_application_submission"
    | "withdraw_application_consent";
  readonly purpose: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly input: "draft" | "patches" | "assistance_decision" | "submission_decision";
}

const stableApplicationToolDefinitions: readonly StableApplicationToolDefinition[] = [
  {
    name: "get_application_readiness",
    purpose: "Check what one private application still needs, without returning its answers.",
    description:
      "Pass the application ID returned by prepare_application as draftId. Read safe completion counts, missing field keys and labels, receipt state, and the next useful action without returning private answers.",
    readOnly: true,
    input: "draft",
  },
  {
    name: "request_application_assistance",
    purpose: "Take short-lived permission to prepare one private application; nothing is asked.",
    description:
      "Pass the application ID returned by prepare_application as draftId. The person's request to apply is the authority: assistance is granted at once, without a question, and propose_application_updates is the next step. Nothing is sent to an employer until the person approves the exact completed application.",
    readOnly: false,
    input: "draft",
  },
  {
    name: "decide_application_assistance",
    purpose: "Withdraw assistance for one application when the person asks.",
    description:
      "Assistance is granted automatically; call this only when the person asks to stop the agent's help. Pass draftId, the requestId from request_application_assistance, and withdraw (or declined) to revoke active assistance bound to it; it never shares data or submits.",
    readOnly: false,
    input: "assistance_decision",
  },
  {
    name: "propose_application_updates",
    purpose: "Prepare several truthful answers in one identified application.",
    description:
      "Pass draftId for the application and update up to 24 distinct fields from known facts in one call. For cover_letter, use the full role and local CV context but send only the finished letter. Ask once, in a single message, for every fact readiness reports as missing; skip optional fields the person never mentioned.",
    readOnly: false,
    input: "patches",
  },
  {
    name: "request_submission_review",
    purpose: "Ask the person to review one exact completed application.",
    description:
      "Pass draftId for the completed application. Freeze its exact field values and return them to the already-authorized agent client. Present every value before asking for one final decision. The review link is an optional browser fallback; this submits nothing.",
    readOnly: false,
    input: "draft",
  },
  {
    name: "decide_application_submission",
    purpose: "Record the person's exact submission decision from the agent client.",
    description:
      "Pass draftId for the same application, the exact requestId and draftVersion returned by request_submission_review, and the person's explicit decision. Never approve on the person's behalf. On approval, store disclosure consent, seal the unchanged payload, submit once, and return a receipt; on decline, share and submit nothing.",
    readOnly: false,
    input: "submission_decision",
  },
  {
    name: "withdraw_application_consent",
    purpose: "Withdraw consent for future processing tied to one application.",
    description:
      "Pass draftId for the owner-accessible application to immediately withdraw every live consent-based permission tied to it. This stops future processing under that consent; it does not erase the application or retract a submission already sent.",
    readOnly: false,
    input: "draft",
  },
];

export interface StableApplicationToolDependencies {
  resolveApplication(
    draftId: string,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<Readonly<{
    readiness: ApplicationToolReadiness;
    surface: ApplicationToolDependencies | null;
  }> | null>;
  withdrawConsent(
    draftId: string,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<ApplicationConsentWithdrawal>;
}

export function createStableApplicationToolManifests(
  dependencies: StableApplicationToolDependencies,
): readonly ToolManifest<unknown, ApplicationToolOutput>[] {
  return stableApplicationToolDefinitions.map((definition) => ({
    name: definition.name,
    purpose: definition.purpose,
    description: definition.description,
    inputSchema:
      definition.input === "patches"
        ? stablePatchesInputSchema
        : definition.input === "assistance_decision"
          ? stableAssistanceDecisionInputSchema
          : definition.input === "submission_decision"
            ? stableSubmissionDecisionInputSchema
            : stableDraftInputSchema,
    annotations: { readOnlyHint: definition.readOnly, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsedPatches =
          definition.input === "patches" ? stablePatchesInput.parse(input) : null;
        const parsedAssistanceDecision =
          definition.input === "assistance_decision"
            ? stableAssistanceDecisionInput.parse(input)
            : null;
        const parsedSubmissionDecision =
          definition.input === "submission_decision"
            ? stableSubmissionDecisionInput.parse(input)
            : null;
        const parsed =
          parsedPatches ??
          parsedAssistanceDecision ??
          parsedSubmissionDecision ??
          stableDraftInput.parse(input);
        const resolved = await dependencies.resolveApplication(parsed.draftId, { signal });
        if (resolved === null) {
          return failedWebMcpResult({
            code: "NOT_FOUND",
            message: "That owner-accessible application could not be found.",
            retryable: false,
          });
        }
        const { readiness: verified, surface } = resolved;

        if (definition.name === "get_application_readiness") {
          return completed("Checked what this application needs next.", verified);
        }
        if (definition.name === "withdraw_application_consent") {
          const result = applicationConsentWithdrawalSchema.parse(
            await dependencies.withdrawConsent(parsed.draftId, { signal }),
          );
          return completedWebMcpResult({
            summary:
              result.withdrawnGrantIds.length === 0
                ? "No active application consent remained to withdraw."
                : "Withdrew application consent and stopped future consent-based processing.",
            data: result,
            resources: [{ type: "application", id: parsed.draftId, label: "Private application" }],
          });
        }
        if (verified.state.stage === "closed" || verified.roleStatus !== "open") {
          return failedWebMcpResult({
            code: "CONFLICT",
            message: "Role closed — nothing submitted.",
            retryable: false,
          });
        }

        if (surface === null || surface.currentReadiness().state.draftId !== parsed.draftId) {
          return failedWebMcpResult({
            code: "NOT_FOUND",
            message: "The verified application could not be prepared for this action.",
            retryable: false,
          });
        }

        if (
          definition.name === "request_application_assistance" &&
          verified.state.agentAuthorityStatus === "active"
        ) {
          // Asking twice is not a fault: the answer is the same, so say so.
          return completedWebMcpResult({
            summary:
              "Preparation is already allowed for this application. Nothing is sent until the person approves the exact application.",
            data: {
              draftId: verified.state.draftId,
              agentAuthorityStatus: verified.state.agentAuthorityStatus,
              nextTool: nextApplicationTool(verified),
            },
            resources: [
              { type: "application", id: verified.state.draftId, label: "Private application" },
            ],
          });
        }

        const active = createApplicationToolManifests(surface);
        const delegate = active.find((tool) => tool.name === definition.name);
        if (delegate === undefined) {
          const available = active.map(({ name }) => name).join(", ");
          const next = nextApplicationTool(verified) ?? verified.nextAction;
          return failedWebMcpResult({
            code: "CONFLICT",
            message: `${definition.name} is not ready yet. Next: ${next}. Available now: ${available}.`,
            retryable: false,
          });
        }

        const delegateInput =
          parsedPatches !== null
            ? { patches: parsedPatches.patches }
            : parsedAssistanceDecision !== null
              ? {
                  requestId: parsedAssistanceDecision.requestId,
                  decision: parsedAssistanceDecision.decision,
                }
              : parsedSubmissionDecision !== null
                ? {
                    requestId: parsedSubmissionDecision.requestId,
                    draftVersion: parsedSubmissionDecision.draftVersion,
                    decision: parsedSubmissionDecision.decision,
                  }
                : {};
        return delegate.execute(delegateInput, { signal });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide an owner-accessible application ID and the documented inputs.",
        );
      }
    },
  }));
}
