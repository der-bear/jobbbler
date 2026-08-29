import { z } from "zod";

import type { AgentOperation, ApplicationAgentState } from "@jobbbler/contracts";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import {
  completedWebMcpResult,
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

const answerInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fieldKey: {
      type: "string",
      description: "A field key exposed by the current application workspace.",
      maxLength: 64,
    },
    value: {
      type: "string",
      description: "A suggested answer; the candidate must accept it before it counts as complete.",
      maxLength: 10_000,
    },
  },
  required: ["fieldKey", "value"],
} as const satisfies JsonSchema;

const emptyInput = z.strictObject({});

type ApplicationToolOutput =
  CompletedWebMcpResult<JsonValue> | RequiresUserActionWebMcpResult | SafeWebMcpErrorResult;

export interface ApplicationToolDependencies {
  readonly fieldKeys: readonly string[];
  currentState(): ApplicationAgentState;
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
  setAnswer(
    input: Readonly<{ fieldKey: string; value: string }>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<ApplicationAgentState>;
  validate(options: Readonly<{ signal: AbortSignal }>): Promise<ApplicationAgentState>;
  review(options: Readonly<{ signal: AbortSignal }>): Promise<ApplicationAgentState>;
  requestDataPermission(options: Readonly<{ signal: AbortSignal }>): Promise<{
    readonly state: ApplicationAgentState;
    readonly request: ApplicationInteractionRequest;
  }>;
  finalConfirmationRequest(): ApplicationInteractionRequest;
  submit(options: Readonly<{ signal: AbortSignal }>): Promise<ApplicationAgentState>;
}

interface ApplicationInteractionRequest {
  readonly id: string;
  readonly recipient: string;
  readonly purpose: string;
  readonly categories: readonly string[];
  readonly fieldKeys: readonly string[];
  readonly noticeVersion: string;
  readonly expiresAt?: string;
}

function safeState(state: ApplicationAgentState): JsonValue {
  return {
    draftId: state.draftId,
    jobId: state.jobId,
    state: state.state,
    stage: state.stage,
    version: state.version,
    requiredFields: state.requiredFields,
    completedRequiredFields: state.completedRequiredFields,
    reviewStatus: state.reviewStatus,
    dataPermissionStatus: state.dataPermissionStatus,
    agentAuthorityStatus: state.agentAuthorityStatus,
    finalConfirmationReady: state.finalConfirmationReady,
    receiptStatus: state.receiptStatus,
  };
}

function completed(summary: string, state: ApplicationAgentState): ApplicationToolOutput {
  return completedWebMcpResult({
    summary,
    data: safeState(state),
    resources: [{ type: "application", id: state.draftId, label: "Private application draft" }],
    facts: [
      { key: "application_stage", value: state.stage },
      { key: "draft_version", value: state.version },
    ],
  });
}

function requiredOperations(
  state: ApplicationAgentState,
  allowsAgentSubmission: boolean,
): readonly AgentOperation[] {
  if (state.stage === "profile") {
    return ["read_application", "edit_application", "validate_application"];
  }
  if (state.stage === "review") return ["read_application", "review_application"];
  if (state.stage === "permission") return ["read_application", "request_data_consent"];
  if (state.stage === "confirmation") {
    return allowsAgentSubmission
      ? ["read_application", "request_confirmation", "submit_application"]
      : ["read_application", "request_confirmation"];
  }
  return ["read_application"];
}

function hasRequiredAuthority(
  dependencies: ApplicationToolDependencies,
  operations: readonly AgentOperation[],
): boolean {
  return (
    dependencies.hasAgentCredential() &&
    operations.every((operation) => dependencies.isOperationAuthorized(operation))
  );
}

function readStateTool(
  dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "get_application_state",
    purpose: "Read the current private application's workflow state without candidate answers.",
    description:
      "Read the current application stage, version, completion counts, permission state, and receipt state. Candidate answers, owner identity, tokens, and contact details are never returned.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        return completed(
          "Read the current application workflow state.",
          dependencies.currentState(),
        );
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Application state accepts no arguments.");
      }
    },
  };
}

function requestAccessTool(
  dependencies: ApplicationToolDependencies,
  operations: readonly AgentOperation[],
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "request_application_access",
    purpose: "Request the minimum agent authority needed for the current application stage.",
    description:
      "Create a short-lived, draft-bound authority request for the current stage. The raw agent credential stays only in this first-party page; a human must approve the named operations before use.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        const { request } = await dependencies.requestAgentAccess(operations, { signal });
        return requiresUserActionWebMcpResult({
          summary: "Application assistance is ready for the user's decision in Jobbbler.",
          kind: "agent_authorization",
          surface: "application_authorization",
          requestId: request.id,
          presentation: {
            title: "Allow application assistance?",
            prompt: `Allow these actions for this draft until ${request.expiresAt}: ${request.operations.join(", ")}. Purpose: ${request.purpose}`,
            confirmLabel: "Review in Jobbbler",
            facts: [
              { key: "Actions", value: request.operations.join(", ") },
              { key: "Expires", value: request.expiresAt },
            ],
          },
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Agent access accepts no arguments.");
      }
    },
  };
}

function profileTools(
  dependencies: ApplicationToolDependencies,
): readonly ToolManifest<unknown, ApplicationToolOutput>[] {
  const answerInput = z
    .strictObject({ fieldKey: z.string().max(64), value: z.string().max(10_000) })
    .superRefine((input, context) => {
      if (!dependencies.fieldKeys.includes(input.fieldKey)) {
        context.addIssue({
          code: "custom",
          path: ["fieldKey"],
          message: "The field is not exposed by this application.",
        });
      }
    });
  return [
    {
      name: "set_application_answer",
      purpose: "Suggest one answer in the current application for the candidate to accept or edit.",
      description:
        "Set one draft answer as an agent suggestion. The suggestion remains visibly unaccepted and never satisfies a required field until the candidate accepts or edits it in the page.",
      inputSchema: answerInputSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input, { signal }) {
        try {
          const parsed = answerInput.parse(input);
          const state = await dependencies.setAnswer(parsed, { signal });
          return completed("Saved an agent suggestion for candidate review.", state);
        } catch (error) {
          return safeWebMcpErrorResult(
            error,
            signal,
            "Provide one supported field key and a text suggestion without extra properties.",
          );
        }
      },
    },
    {
      name: "validate_application",
      purpose: "Validate accepted candidate facts in the current application draft.",
      description:
        "Validate that every required field has a non-empty answer accepted by the candidate. Agent suggestions alone do not pass validation; the visible workspace is updated after success.",
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input, { signal }) {
        try {
          emptyInput.parse(input);
          return completed(
            "Validated the candidate-accepted application facts.",
            await dependencies.validate({ signal }),
          );
        } catch (error) {
          return safeWebMcpErrorResult(
            error,
            signal,
            "Application validation accepts no arguments.",
          );
        }
      },
    },
  ];
}

function reviewTool(
  dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "review_application",
    purpose: "Seal the validated application into an immutable review snapshot.",
    description:
      "Seal the current validated draft so later data permission and confirmation bind to its exact payload hash and version. Any later material edit invalidates the snapshot.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        return completed(
          "Sealed the validated application review.",
          await dependencies.review({ signal }),
        );
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Application review accepts no arguments.");
      }
    },
  };
}

function permissionTool(
  dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "request_data_permission",
    purpose: "Request human permission for the exact reviewed application disclosure.",
    description:
      "Request a purpose-bound data permission for the current review, recipient, fields, categories, notice, and payload hash. The candidate must approve the pending disclosure in the visible private workspace.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        const { request } = await dependencies.requestDataPermission({ signal });
        return requiresUserActionWebMcpResult({
          summary:
            "The exact reviewed disclosure is ready for the user's decision in Jobbbler.",
          kind: "data_consent",
          surface: "data_consent",
          requestId: request.id,
          presentation: {
            title: "Share this reviewed application?",
            prompt: `Allow ${request.recipient} to receive ${request.fieldKeys.join(", ")} for this purpose: ${request.purpose}`,
            confirmLabel: "Review disclosure in Jobbbler",
            facts: [
              { key: "Recipient", value: request.recipient },
              { key: "Purpose", value: request.purpose },
              { key: "Data", value: request.categories.join(", ") },
              { key: "Fields", value: request.fieldKeys.join(", ") },
              { key: "Notice", value: request.noticeVersion },
            ],
          },
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Data permission accepts no arguments.");
      }
    },
  };
}

function confirmationTool(
  dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "request_final_confirmation",
    purpose: "Ask the candidate for a fresh final confirmation of the sealed application.",
    description:
      "Return the exact final-action request for the candidate to review in Jobbbler. This does not issue a confirmation or submit anything.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        const request = dependencies.finalConfirmationRequest();
        return requiresUserActionWebMcpResult({
          summary:
            "The exact reviewed application is ready for the user's final decision in Jobbbler.",
          kind: "action_confirmation",
          surface: "application_review",
          requestId: request.id,
          presentation: {
            title: "Confirm this exact application?",
            prompt: `Confirm the sealed application to ${request.recipient} for this purpose: ${request.purpose}. This confirmation expires after five minutes and can be used once.`,
            confirmLabel: "Review application in Jobbbler",
            facts: [
              { key: "Recipient", value: request.recipient },
              { key: "Purpose", value: request.purpose },
              { key: "Data", value: request.categories.join(", ") },
              { key: "Fields", value: request.fieldKeys.join(", ") },
              { key: "Notice", value: request.noticeVersion },
            ],
          },
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Final confirmation accepts no arguments.");
      }
    },
  };
}

function submitTool(
  dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "submit_application",
    purpose: "Submit the current sealed application using its fresh human confirmation.",
    description:
      "Submit the exact reviewed payload only when agent authority, active data permission, and the candidate's fresh single-use confirmation all still match. Returns a non-secret receipt state.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        return completed(
          "Submitted the reviewed application and recorded its receipt.",
          await dependencies.submit({ signal }),
        );
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Application submission accepts no arguments.");
      }
    },
  };
}

function externalHandoffTool(
  _dependencies: ApplicationToolDependencies,
): ToolManifest<unknown, ApplicationToolOutput> {
  return {
    name: "prepare_external_handoff",
    purpose:
      "Leave an external application ready for the candidate to open from the visible workspace.",
    description:
      "External applications require a human to record the handoff and explicitly select the exact source link in the visible workspace. This tool never navigates or claims that an application was submitted.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        return requiresUserActionWebMcpResult({
          summary:
            "The reviewed external application is ready. The candidate must use the visible workspace to record the handoff, then explicitly select its source link.",
          kind: "action_confirmation",
          surface: "application_review",
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "External handoff accepts no arguments.");
      }
    },
  };
}

export function createApplicationToolManifests(
  dependencies: ApplicationToolDependencies,
): readonly ToolManifest<unknown, ApplicationToolOutput>[] {
  const state = dependencies.currentState();
  const tools: ToolManifest<unknown, ApplicationToolOutput>[] = [readStateTool(dependencies)];
  if (state.stage === "complete") return tools;

  const allowsAgentSubmission = dependencies.allowsAgentSubmission();
  const operations = requiredOperations(state, allowsAgentSubmission);
  if (!hasRequiredAuthority(dependencies, operations)) {
    if (state.agentAuthorityStatus !== "requested" || !dependencies.hasAgentCredential()) {
      tools.push(requestAccessTool(dependencies, operations));
    }
    return tools;
  }

  if (state.stage === "profile") tools.push(...profileTools(dependencies));
  else if (state.stage === "review") tools.push(reviewTool(dependencies));
  else if (state.stage === "permission" && state.dataPermissionStatus === "none") {
    tools.push(permissionTool(dependencies));
  } else if (state.stage === "confirmation") {
    if (state.finalConfirmationReady) {
      tools.push(
        allowsAgentSubmission ? submitTool(dependencies) : externalHandoffTool(dependencies),
      );
    } else {
      tools.push(confirmationTool(dependencies));
    }
  }
  return tools;
}
