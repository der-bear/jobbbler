import { z } from "zod";

import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import {
  completedWebMcpResult,
  safeWebMcpErrorResult,
  type CompletedWebMcpResult,
  type SafeWebMcpErrorResult,
} from "@/lib/webmcp-tool-result";

export const workflowGoals = [
  "find_roles",
  "compare_roles",
  "save_search",
  "monitor_search",
  "prepare_application",
  "enable_recovery",
  "recover_workspace",
] as const;

export type WorkflowGoal = (typeof workflowGoals)[number];

interface WorkflowStep {
  readonly intent: string;
  readonly tool: string | null;
  readonly humanAction: string | false;
  readonly requiredInputs?: readonly string[];
}

interface WorkflowBranch {
  readonly when: string;
  readonly steps: readonly WorkflowStep[];
}

interface WorkflowPlan {
  readonly title: string;
  readonly steps: readonly WorkflowStep[];
  readonly branches?: readonly WorkflowBranch[];
}

export const workflowVersion = "2.8";
export const workflowBoundaries: readonly string[] = [
  "Advice only; grants no authority.",
  "Decide in the agent client.",
  "Monitoring cannot submit.",
];

export const workflowPlans: Readonly<Record<WorkflowGoal, WorkflowPlan>> = {
  find_roles: {
    title: "Find matching roles",
    steps: [
      {
        intent: "Learn the accepted filter values when unsure",
        tool: "get_search_filters",
        humanAction: false,
      },
      {
        intent: "Run a deterministic search",
        tool: "search_jobs",
        requiredInputs: ["known search criteria"],
        humanAction: false,
      },
      { intent: "Confirm the applied filters", tool: "get_search_state", humanAction: false },
      {
        intent: "Open a promising role",
        tool: "open_job_details",
        requiredInputs: ["jobId"],
        humanAction: false,
      },
      {
        intent: "Read its source-backed facts",
        tool: "get_job_details",
        requiredInputs: ["jobId"],
        humanAction: false,
      },
    ],
  },
  compare_roles: {
    title: "Compare a shortlist",
    steps: [
      {
        intent: "Search for candidate roles",
        tool: "search_jobs",
        requiredInputs: ["known search criteria"],
        humanAction: false,
      },
      {
        intent: "Open the strongest role",
        tool: "open_job_details",
        requiredInputs: ["jobId"],
        humanAction: false,
      },
      {
        intent: "Start a comparison with up to two more",
        tool: "compare_jobs",
        requiredInputs: ["jobIds: 2–3 exact IDs"],
        humanAction: false,
      },
      { intent: "Read the side-by-side facts", tool: "get_comparison", humanAction: false },
      {
        intent: "Adjust the set as needed",
        tool: "add_job_to_comparison",
        requiredInputs: ["jobId"],
        humanAction: false,
      },
    ],
  },
  save_search: {
    title: "Save a search for later",
    steps: [
      {
        intent: "Run the search worth saving",
        tool: "search_jobs",
        requiredInputs: ["known search criteria"],
        humanAction: false,
      },
      {
        intent: "Read criteria in the exact reusable shape",
        tool: "get_search_state",
        requiredInputs: ["detail=exact"],
        humanAction: false,
      },
      {
        intent: "Save the exact criteria for later. Email updates stay off",
        tool: "save_job_search",
        requiredInputs: ["name", "criteria from get_search_state.data.criteria"],
        humanAction: false,
      },
    ],
  },
  monitor_search: {
    title: "Keep a search updated",
    steps: [
      {
        intent: "Run the search worth monitoring",
        tool: "search_jobs",
        requiredInputs: ["known search criteria"],
        humanAction: false,
      },
      {
        intent: "Read criteria in the exact reusable shape",
        tool: "get_search_state",
        requiredInputs: ["detail=exact"],
        humanAction: false,
      },
      {
        intent: "Prepare the exact alert review and verify a new email only when needed",
        tool: "request_search_alert",
        requiredInputs: [
          "name",
          "criteria from get_search_state.data.criteria",
          "recurrence",
          "email",
        ],
        humanAction: "Review the exact alert and decide in the external agent client.",
      },
      {
        intent: "Record the exact decision and activate only if approved",
        tool: "decide_search_alert",
        requiredInputs: [
          "requestId",
          "reviewToken",
          "decision",
          "6-digit code only when verificationMode=email_code",
        ],
        humanAction: false,
      },
      { intent: "Review saved searches later", tool: "get_saved_alerts", humanAction: false },
      {
        intent: "Read only what changed since the last check",
        tool: "get_latest_search_update",
        requiredInputs: ["savedSearchId"],
        humanAction: false,
      },
      {
        intent: "Reopen the stored criteria any time",
        tool: "open_saved_search",
        requiredInputs: ["savedSearchId"],
        humanAction: false,
      },
      {
        intent: "Manage alert",
        tool: "set_job_alert_state",
        requiredInputs: ["action,target,delete-confirmation"],
        humanAction: false,
      },
    ],
  },
  prepare_application: {
    title: "Prepare application",
    steps: [
      {
        intent: "Open the role",
        tool: "open_job_details",
        requiredInputs: ["jobId"],
        humanAction: false,
      },
      {
        intent: "Read the full role",
        tool: "get_job_details",
        requiredInputs: ["jobId"],
        humanAction: false,
      },
      {
        intent: "Create or reopen the application",
        tool: "prepare_application",
        requiredInputs: ["jobId"],
        humanAction: false,
      },
      {
        intent: "Check missing facts",
        tool: "get_application_readiness",
        requiredInputs: ["draftId"],
        humanAction: false,
      },
      {
        intent: "Request application help",
        tool: "request_application_assistance",
        requiredInputs: ["draftId"],
        humanAction: "Ask in agent client: allow this application.",
      },
      {
        intent: "Record the decision",
        tool: "decide_application_assistance",
        requiredInputs: ["draftId", "requestId", "decision"],
        humanAction: false,
      },
      {
        intent: "Prepare truthful answers and cover letter",
        tool: "propose_application_updates",
        requiredInputs: ["draftId", "patches: fieldKey + value"],
        humanAction: "Use role and local CV facts; ask about gaps. CV stays in the agent client.",
      },
      {
        intent: "Present the exact submission review",
        tool: "request_submission_review",
        requiredInputs: ["draftId"],
        humanAction: "Show all values in the agent client; ask for the final decision.",
      },
      {
        intent: "Submit once if approved",
        tool: "decide_application_submission",
        requiredInputs: ["draftId", "requestId", "draftVersion", "decision"],
        humanAction: false,
      },
    ],
  },
  enable_recovery: {
    title: "Enable optional workspace recovery",
    steps: [
      {
        intent: "Send a verification code for optional workspace recovery",
        tool: "enable_workspace_recovery",
        requiredInputs: ["action=start", "email explicitly supplied by the person"],
        humanAction: "Ask for an email in the agent client only if the person wants recovery.",
      },
      {
        intent: "Complete optional recovery setup",
        tool: "enable_workspace_recovery",
        requiredInputs: [
          "action=complete",
          "challengeId from start",
          "6-digit code from the person",
        ],
        humanAction: "Ask for the six-digit code in the agent client.",
      },
    ],
  },
  recover_workspace: {
    title: "Restore private work",
    steps: [
      {
        intent: "Send a recovery code",
        tool: "recover_jobbbler_workspace",
        requiredInputs: ["action=start", "verified email supplied by the person"],
        humanAction: "Ask for the verified email in the agent client.",
      },
      {
        intent: "Complete workspace recovery",
        tool: "recover_jobbbler_workspace",
        requiredInputs: [
          "action=complete",
          "recoveryId from start",
          "6-digit code from the person",
        ],
        humanAction: "Ask for the six-digit code in the agent client.",
      },
      {
        intent: "Confirm the restored applications",
        tool: "get_applications",
        humanAction: false,
      },
      {
        intent: "Confirm the restored saved searches",
        tool: "get_saved_alerts",
        humanAction: false,
      },
    ],
  },
};

const planInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goal: {
      type: "string",
      description: "The outcome to plan for.",
      enum: [...workflowGoals],
    },
  },
  required: ["goal"],
} as const satisfies JsonSchema;

const planInput = z.strictObject({ goal: z.enum(workflowGoals) });

type PlannerOutput = CompletedWebMcpResult<JsonValue> | SafeWebMcpErrorResult;

function preferredTool(goal: WorkflowGoal, route: string): string | null {
  if (goal === "prepare_application" && route === "/apply/:draftId") {
    return "get_application_readiness";
  }
  if (goal === "compare_roles" && route === "/compare") return "get_comparison";
  if (goal === "monitor_search" && route === "/saved") return "get_saved_alerts";
  if (goal === "prepare_application" && route === "/jobs/:jobId") {
    return "get_job_details";
  }
  if (goal === "find_roles" && route === "/jobs/:jobId") return "get_job_details";
  return null;
}

export function createWorkflowPlannerTool(
  context: Readonly<{
    route: string | (() => string);
    availableTools: () => readonly string[];
  }>,
): ToolManifest<unknown, PlannerOutput> {
  return {
    name: "plan_job_workflow",
    purpose: "Return the recommended safe steps for one Jobbbler goal from the current page.",
    description:
      "Pass one required goal: find_roles, compare_roles, save_search, monitor_search, prepare_application, enable_recovery, or recover_workspace. The result is a concise, route-aware tool sequence with human decision points. Advisory only — it executes nothing, grants nothing, and confirms nothing.",
    inputSchema: planInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute(input, { signal }) {
      try {
        const parsed = planInput.parse(input);
        const plan = workflowPlans[parsed.goal];
        const availableNow = context.availableTools();
        const currentRoute = typeof context.route === "function" ? context.route() : context.route;
        const preferred = preferredTool(parsed.goal, currentRoute);
        const everyStep = [...plan.steps, ...(plan.branches?.flatMap(({ steps }) => steps) ?? [])];
        const preferredStep = everyStep.find(
          (step) =>
            step.tool === preferred && step.tool !== null && availableNow.includes(step.tool),
        );
        const nextStep =
          preferredStep ??
          everyStep.find((step) => step.tool === null || availableNow.includes(step.tool));
        return completedWebMcpResult({
          summary: `Planned “${plan.title}”: ${String(everyStep.length)} steps; advisory.`,
          data: {
            workflowVersion,
            goal: parsed.goal,
            currentRoute,
            nextTool: nextStep?.tool ?? null,
            nextInputs: nextStep?.requiredInputs ?? [],
            ...(nextStep === undefined || nextStep.humanAction === false
              ? {}
              : { nextHumanAction: nextStep.humanAction }),
            steps: plan.steps.map((step) => ({
              intent: step.intent,
              tool: step.tool,
              needs: step.requiredInputs ?? [],
              ...(step.humanAction === false ? {} : { ask: step.humanAction }),
            })),
            ...(plan.branches === undefined
              ? {}
              : {
                  branches: plan.branches.map((branch) => ({
                    when: branch.when,
                    steps: branch.steps.map((step) => ({
                      intent: step.intent,
                      tool: step.tool,
                      needs: step.requiredInputs ?? [],
                      ...(step.humanAction === false ? {} : { ask: step.humanAction }),
                    })),
                  })),
                }),
            boundaries: [...workflowBoundaries],
          },
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Provide one supported goal.");
      }
    },
  };
}
