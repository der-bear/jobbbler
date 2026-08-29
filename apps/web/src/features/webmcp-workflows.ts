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
}

interface WorkflowPlan {
  readonly title: string;
  readonly steps: readonly WorkflowStep[];
}

export const workflowVersion = "1.0";

export const workflowBoundaries: readonly string[] = [
  "This plan is advice from the site; it grants no authority and executes nothing.",
  "Data consent and the final application confirmation are separate human decisions.",
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
      { intent: "Run a deterministic search", tool: "search_jobs", humanAction: false },
      { intent: "Confirm the applied filters", tool: "get_search_state", humanAction: false },
      { intent: "Open a promising role", tool: "open_job_details", humanAction: false },
      { intent: "Read its source-backed facts", tool: "get_job_details", humanAction: false },
    ],
  },
  compare_roles: {
    title: "Compare a shortlist",
    steps: [
      { intent: "Search for candidate roles", tool: "search_jobs", humanAction: false },
      { intent: "Open the strongest role", tool: "open_job_details", humanAction: false },
      {
        intent: "Start a comparison with up to two more",
        tool: "compare_jobs",
        humanAction: false,
      },
      { intent: "Read the side-by-side facts", tool: "get_comparison", humanAction: false },
      { intent: "Adjust the set as needed", tool: "add_job_to_comparison", humanAction: false },
    ],
  },
  monitor_search: {
    title: "Keep a search updated",
    steps: [
      { intent: "Run the search worth monitoring", tool: "search_jobs", humanAction: false },
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
        humanAction: false,
      },
      {
        intent: "Reopen the stored criteria any time",
        tool: "open_saved_search",
        humanAction: false,
      },
      { intent: "Pause or resume checking", tool: "set_job_alert_state", humanAction: false },
    ],
  },
  prepare_application: {
    title: "Prepare one deliberate application",
    steps: [
      { intent: "Open the role", tool: "open_job_details", humanAction: false },
      {
        intent: "Check how this role accepts applications",
        tool: "get_job_application_capability",
        humanAction: false,
      },
      {
        intent: "Start the application",
        tool: null,
        humanAction: "Choose Apply with Jobbbler on the role page.",
      },
      {
        intent: "Request stage-scoped access",
        tool: "request_application_access",
        humanAction: "Approve the named operations in the private application workspace.",
      },
      {
        intent: "Suggest answers for review",
        tool: "set_application_answer",
        humanAction: "Accept or edit every suggestion.",
      },
      { intent: "Validate the accepted facts", tool: "validate_application", humanAction: false },
      { intent: "Seal the exact reviewed version", tool: "review_application", humanAction: false },
      {
        intent: "Request the exact disclosure",
        tool: "request_data_permission",
        humanAction: "Approve what is shared, with whom, and why.",
      },
      {
        intent: "Confirm once, within five minutes",
        tool: "request_final_confirmation",
        humanAction: "Give the final confirmation yourself in the private application workspace.",
      },
      { intent: "Submit the sealed application", tool: "submit_application", humanAction: false },
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

export function createWorkflowPlannerTool(
  context: Readonly<{ route: string; availableTools: () => readonly string[] }>,
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
        return completedWebMcpResult({
          summary: `Planned “${plan.title}”: ${String(plan.steps.length)} steps, advisory only.`,
          data: {
            workflowVersion,
            goal: parsed.goal,
            currentRoute: context.route,
            availableNow: [...availableNow],
            recommendedSteps: plan.steps.map((step) => ({
              intent: step.intent,
              tool: step.tool,
              humanAction: step.humanAction,
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
