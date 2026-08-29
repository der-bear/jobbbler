import { z } from "zod";

import {
  applicationConsentWithdrawalSchema,
  entityIdSchema,
  type AgentOperation,
  type ApplicationAgentState,
  type ApplicationConsentWithdrawal,
  type ApplicationSubmissionReviewRequest as ApplicationSubmissionReviewContract,
} from "@jobbbler/contracts";
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

const emptyInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const satisfies JsonSchema;

const patchesProperty = {
  type: "array",
  description:
    "Application answers the agent can prepare from known facts. Ask the person when a required fact is missing; never invent it.",
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
        description: "A truthful answer or draft written from facts the person supplied.",
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

const decisionProperty = {
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
    decision: decisionProperty,
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
    decision: decisionProperty,
  },
  required: ["requestId", "draftVersion", "decision"],
} as const satisfies JsonSchema;

const emptyInput = z.strictObject({});
const decision = z.enum(["approved", "declined"]);
const assistanceDecisionInput = z.strictObject({
  requestId: entityIdSchema.refine((value) => value.startsWith("delegation_"), {
    message: "Expected the server-issued assistance request ID.",
  }),
  decision,
});
const submissionDecisionInput = z.strictObject({
  requestId: z.string().max(128),
  draftVersion: z.number().int().nonnegative(),
  decision,
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
  readonly missingFieldKeys: readonly string[];
  readonly missingFieldLabels: readonly string[];
  readonly nextAction: "prepare" | "review" | "submit" | "complete";
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
    decision: "approved" | "declined",
    options: Readonly<{ signal: AbortSignal; channel: "agent_client" }>,
  ): Promise<{
    readonly state: ApplicationAgentState;
    readonly decision: "approved" | "declined";
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
  ): Promise<ApplicationToolReadiness>;
}

function safeReadiness(readiness: ApplicationToolReadiness): JsonValue {
  const { state } = readiness;
  return {
    draftId: state.draftId,
    jobId: state.jobId,
    state: state.state,
    stage: state.stage,
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
  if (readiness.nextAction === "complete") return null;
  if (state.agentAuthorityStatus === "requested") return "decide_application_assistance";
  if (state.agentAuthorityStatus !== "active") return "request_application_assistance";
  if (readiness.missingFieldKeys.length > 0) return "propose_application_updates";
  return state.finalConfirmationReady
    ? "decide_application_submission"
    : "request_submission_review";
}

function completed(summary: string, readiness: ApplicationToolReadiness): ApplicationToolOutput {
  return completedWebMcpResult({
    summary,
    data: safeReadiness(readiness),
    resources: [{ type: "application", id: readiness.state.draftId, label: "Private application" }],
    facts: [
      { key: "missing_required_fields", value: readiness.missingFieldKeys.length },
      { key: "next_action", value: readiness.nextAction },
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
    purpose: "Ask once for short-lived permission to prepare this private application.",
    description:
      "Request draft-bound authority so the agent can read workflow state, prepare truthful answers, and run server safeguards. This does not share candidate data or submit the application. The person still reviews the exact application before submission.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        const { request } = await dependencies.requestAgentAccess(
          assistanceOperations(dependencies.allowsAgentSubmission()),
          { signal },
        );
        return requiresUserActionWebMcpResult({
          summary: "Application assistance is ready for the person's decision in the agent client.",
          kind: "agent_authorization",
          surface: "application_authorization",
          requestId: request.id,
          nextTool: "decide_application_assistance",
          presentation: {
            title: "Let Jobbbler prepare this application?",
            prompt:
              "Allow the agent to prepare this private draft from facts you provide. Nothing is shared or submitted until you review the exact application.",
            confirmLabel: "Allow once",
            facts: [
              { key: "Scope", value: "This application only" },
              { key: "Expires", value: request.expiresAt },
            ],
          },
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
    purpose: "Record the person's assistance decision from the agent client.",
    description:
      "Use the exact requestId returned by request_application_assistance and the person's explicit approved or declined decision. Never infer or approve this decision on the person's behalf. Approval is short-lived and draft-bound; it never shares data or submits an application.",
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
              : "Recorded the decision and kept application assistance off.",
          data: {
            draftId: result.state.draftId,
            decision: result.decision,
            agentAuthorityStatus: result.state.agentAuthorityStatus,
            nextTool: result.decision === "approved" ? "get_application_readiness" : null,
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
      "Update up to 24 distinct fields in one bounded call. Use known profile facts or ask the person for missing facts; never infer sensitive information. The person sees the resulting application before anything is shared.",
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
      "Present one clear final review with the recipient, purpose, included fields, and privacy notice. This tool grants no permission and submits nothing by itself.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        const request = await dependencies.requestSubmissionReview({ signal });
        return requiresUserActionWebMcpResult({
          summary:
            "The completed application is ready for the person's final review in the agent client.",
          kind: "action_confirmation",
          surface: "application_review",
          requestId: request.id,
          nextTool: "decide_application_submission",
          presentation: {
            title: "Review and submit this application?",
            prompt: `Review the exact application for ${request.recipient}. Submission happens only after this decision.`,
            confirmLabel: "Submit this application",
            facts: [
              { key: "Recipient", value: request.recipient },
              { key: "Purpose", value: request.purpose },
              { key: "Included", value: request.fieldLabels.join(", ") },
              { key: "Privacy notice", value: request.noticeVersion },
              {
                key: "Withdrawal",
                value:
                  "Available any time in your agent client; it stops future consent-based processing.",
              },
              { key: "Draft version", value: request.draftVersion },
            ],
          },
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
        const readiness = await dependencies.decideSubmission(
          parsed.draftVersion,
          parsed.decision,
          { signal, channel: "agent_client" },
        );
        return completed(
          parsed.decision === "approved"
            ? "Recorded consent, submitted the approved application, and saved its receipt."
            : "Declined. No data was shared and nothing was submitted.",
          readiness,
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
  if (readiness.nextAction === "complete") return tools;

  if (!hasPreparationAuthority(dependencies)) {
    tools.push(
      readiness.state.agentAuthorityStatus === "requested"
        ? assistanceDecisionTool(dependencies)
        : assistanceTool(dependencies),
    );
    return tools;
  }

  tools.push(updatesTool(dependencies));
  if (readiness.missingFieldKeys.length > 0) return tools;

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
  return tools;
}

const draftIdProperty = {
  type: "string",
  description: "An application draft ID returned by prepare_application.",
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
    message: "Expected an application draft ID returned by prepare_application.",
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
      "Read safe completion counts, missing field keys and labels, receipt state, and the next useful action for one owner-accessible application.",
    readOnly: true,
    input: "draft",
  },
  {
    name: "request_application_assistance",
    purpose: "Ask once for short-lived permission to prepare one private application.",
    description:
      "Request draft-bound preparation authority. This does not disclose candidate data or submit the application, and the person still reviews the exact result.",
    readOnly: false,
    input: "draft",
  },
  {
    name: "decide_application_assistance",
    purpose: "Record the person's assistance decision from the agent client.",
    description:
      "Use the exact requestId returned by request_application_assistance and the person's explicit approved or declined decision. Never infer or approve this decision on the person's behalf. Approval is short-lived and limited to one private application.",
    readOnly: false,
    input: "assistance_decision",
  },
  {
    name: "propose_application_updates",
    purpose: "Prepare several truthful answers in one identified application.",
    description:
      "Update up to 24 distinct fields from known facts in one call. Ask for missing facts instead of inventing them; the person sees the result before submission.",
    readOnly: false,
    input: "patches",
  },
  {
    name: "request_submission_review",
    purpose: "Ask the person to review one exact completed application.",
    description:
      "Present the recipient, purpose, included fields, and privacy notice in the agent client for one final decision. This submits nothing.",
    readOnly: false,
    input: "draft",
  },
  {
    name: "decide_application_submission",
    purpose: "Record the person's exact submission decision from the agent client.",
    description:
      "Use the exact requestId and draftVersion returned by request_submission_review plus the person's explicit decision. Never approve on the person's behalf. On approval, store disclosure consent, seal the unchanged payload, submit once, and return a receipt; on decline, share and submit nothing.",
    readOnly: false,
    input: "submission_decision",
  },
  {
    name: "withdraw_application_consent",
    purpose: "Withdraw consent for future processing tied to one application.",
    description:
      "Use this to immediately withdraw every live consent-based permission for one owner-accessible application. This stops future processing under that consent; it does not erase the application or retract a submission already sent.",
    readOnly: false,
    input: "draft",
  },
];

export interface StableApplicationToolDependencies {
  currentSurface(): ApplicationToolDependencies | null;
  readApplication(
    draftId: string,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<ApplicationToolReadiness | null>;
  withdrawConsent(
    draftId: string,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<ApplicationConsentWithdrawal>;
  onNavigate(href: string): Promise<void> | void;
  waitForSurface?(
    draftId: string,
    signal: AbortSignal,
  ): Promise<ApplicationToolDependencies | null>;
}

function surfaceDraftId(surface: ApplicationToolDependencies | null): string | null {
  return surface?.currentReadiness().state.draftId ?? null;
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
        const verified = await dependencies.readApplication(parsed.draftId, { signal });
        if (verified === null) {
          return failedWebMcpResult({
            code: "NOT_FOUND",
            message: "That owner-accessible application could not be found.",
            retryable: false,
          });
        }

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

        let surface = dependencies.currentSurface();
        if (surfaceDraftId(surface) !== parsed.draftId) {
          await dependencies.onNavigate(`/apply/${encodeURIComponent(parsed.draftId)}`);
          surface =
            (await dependencies.waitForSurface?.(parsed.draftId, signal)) ??
            dependencies.currentSurface();
        }
        if (surface === null || surfaceDraftId(surface) !== parsed.draftId) {
          return failedWebMcpResult({
            code: "NOT_FOUND",
            message: "The verified application could not be opened for this action.",
            retryable: false,
          });
        }

        const active = createApplicationToolManifests(surface);
        const delegate = active.find((tool) => tool.name === definition.name);
        if (delegate === undefined) {
          const available = active.map(({ name }) => name).join(", ");
          return failedWebMcpResult({
            code: "CONFLICT",
            message: `${definition.name} is not ready yet. Next: ${verified.nextAction}. Available now: ${available}.`,
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
          "Provide an owner-accessible application draft ID and the documented inputs.",
        );
      }
    },
  }));
}
