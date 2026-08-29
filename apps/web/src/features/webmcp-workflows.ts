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
  "monitor_search",
  "prepare_application",
  "recover_workspace",
] as const;

export type WorkflowGoal = (typeof workflowGoals)[number];

interface WorkflowStep {
  readonly intent: string;
  readonly tool: string | null;
  readonly humanAction: string | false;
  readonly requiredInputs?: readonly string[];
}

interface WorkflowPlan {
  readonly title: string;
  readonly steps: readonly WorkflowStep[];
}

export const workflowVersion = "2.1";

export const workflowBoundaries: readonly string[] = [
  "This plan is advice from the site; it grants no authority and executes nothing.",
  "In an agent flow, human questions and decisions stay in the agent client.",
  "Jobbbler records exact application disclosure consent on the server before submission.",
  "Scheduled monitoring may prepare updates but never submits applications.",
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
  monitor_search: {
    title: "Keep a search updated",
    steps: [
      {
        intent: "Run the search worth monitoring",
        tool: "search_jobs",
        requiredInputs: ["known search criteria"],
        humanAction: false,
      },
      { intent: "Confirm the exact criteria", tool: "get_search_state", humanAction: false },
      {
        intent: "Save it as an email alert",
        tool: null,
        humanAction: "Choose Save alert and verify a delivery email on the Saved page.",
      },
      { intent: "Review saved alerts later", tool: "get_saved_alerts", humanAction: false },
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
        intent: "Pause or resume checking",
        tool: "set_job_alert_state",
        requiredInputs: ["scheduleId", "enabled"],
        humanAction: false,
      },
    ],
  },
  prepare_application: {
    title: "Prepare one deliberate application",
    steps: [
      {
        intent: "Open the role",
        tool: "open_job_details",
        requiredInputs: ["jobId"],
        humanAction: false,
      },
      {
        intent: "Check how this role accepts applications",
        tool: "get_job_application_capability",
        requiredInputs: ["jobId"],
        humanAction: false,
      },
      {
        intent: "Prepare the application",
        tool: "prepare_application",
        requiredInputs: ["jobId"],
        humanAction: false,
      },
      {
        intent: "Check which facts are still needed",
        tool: "get_application_readiness",
        requiredInputs: ["draftId"],
        humanAction: false,
      },
      {
        intent: "Request short-lived preparation assistance",
        tool: "request_application_assistance",
        requiredInputs: ["draftId"],
        humanAction: "Ask the person in the agent client whether to allow this draft only.",
      },
      {
        intent: "Record that assistance decision",
        tool: "decide_application_assistance",
        requiredInputs: ["draftId", "requestId", "decision"],
        humanAction: false,
      },
      {
        intent: "Prepare answers in one bounded update",
        tool: "propose_application_updates",
        requiredInputs: ["draftId", "patches: fieldKey + value"],
        humanAction: "Ask only for facts that are still missing; never invent them.",
      },
      {
        intent: "Present the exact recipient, data, and purpose",
        tool: "request_submission_review",
        requiredInputs: ["draftId"],
        humanAction: "Ask for one final submission decision in the agent client.",
      },
      {
        intent: "Record the decision and submit once if approved",
        tool: "decide_application_submission",
        requiredInputs: ["draftId", "requestId", "draftVersion", "decision"],
        humanAction: false,
      },
    ],
  },
  recover_workspace: {
    title: "Restore saved work",
    steps: [
      {
        intent: "Restore with the verified email",
        tool: null,
        humanAction: "Open the Saved page and use “Restore with email”; enter the one-time code.",
      },
      { intent: "Confirm the restored alerts", tool: "get_saved_alerts", humanAction: false },
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
  if (goal === "recover_workspace" && route === "/saved") return "get_saved_alerts";
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
      "Return a concise, route-aware plan for a Jobbbler goal: which tools compose the outcome, in what order, and which steps stay with the human. Advisory only — it executes nothing, grants nothing, and confirms nothing.",
    inputSchema: planInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute(input, { signal }) {
      try {
        const parsed = planInput.parse(input);
        const plan = workflowPlans[parsed.goal];
        const availableNow = context.availableTools();
        const currentRoute = typeof context.route === "function" ? context.route() : context.route;
        const preferred = preferredTool(parsed.goal, currentRoute);
        const nextStep =
          plan.steps.find(
            (step) =>
              step.tool === preferred && step.tool !== null && availableNow.includes(step.tool),
          ) ?? plan.steps.find((step) => step.tool !== null && availableNow.includes(step.tool));
        return completedWebMcpResult({
          summary: `Planned “${plan.title}”: ${String(plan.steps.length)} steps, advisory only.`,
          data: {
            workflowVersion,
            goal: parsed.goal,
            currentRoute,
            nextTool: nextStep?.tool ?? null,
            nextInputs: nextStep?.requiredInputs ?? [],
            steps: plan.steps.map((step) => ({
              tool: step.tool,
              needs: step.requiredInputs ?? [],
              ...(step.humanAction === false ? {} : { ask: step.humanAction }),
            })),
            boundaries: [...workflowBoundaries],
          },
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Provide one supported goal.");
      }
    },
  };
}
