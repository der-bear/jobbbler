/**
 * Human-readable catalog of every WebMCP tool Jobbbler can register, grouped by
 * product outcome. This is judge- and developer-facing reference copy;
 * the authoritative registrations live in each feature's webmcp-tools module,
 * and a unit test keeps the two in sync.
 */
export interface CatalogTool {
  readonly name: string;
  readonly purpose: string;
  readonly readOnly: boolean;
}

export interface CatalogRoute {
  readonly route: string;
  readonly title: string;
  readonly note?: string;
  readonly tools: readonly CatalogTool[];
}

export const webMcpCatalog: readonly CatalogRoute[] = [
  {
    route: "*",
    title: "Every page",
    note: "Every capability stays registered across navigation. The groups below explain their purpose; state-gated tools return a clear next step when they are not ready.",
    tools: [
      {
        name: "plan_job_workflow",
        purpose: "Return the recommended safe steps for one Jobbbler goal from the current page.",
        readOnly: true,
      },
      {
        name: "get_search_filters",
        purpose: "Read every filter value this site accepts before composing a search.",
        readOnly: true,
      },
      {
        name: "search_jobs",
        purpose:
          "Search the public technology-job catalog headlessly, or synchronize the visible results when follow mode is requested.",
        readOnly: false,
      },
      {
        name: "open_job_details",
        purpose:
          "Open a known role from any page while keeping every Jobbbler capability available.",
        readOnly: false,
      },
      {
        name: "prepare_application",
        purpose: "Create or reopen one private Jobbbler application for a chosen role.",
        readOnly: false,
      },
      {
        name: "open_jobbbler_page",
        purpose: "Open a Jobbbler workspace from any page using explicit validated identifiers.",
        readOnly: false,
      },
    ],
  },
  {
    route: "/",
    title: "Search",
    tools: [
      {
        name: "get_search_state",
        purpose:
          "Read a bounded summary of the visible search and any explicitly reported truncation.",
        readOnly: true,
      },
    ],
  },
  {
    route: "/jobs/:jobId",
    title: "Role page",
    tools: [
      {
        name: "get_job_details",
        purpose: "Inspect the source-backed facts and fit evidence for the role open on this page.",
        readOnly: true,
      },
      {
        name: "compare_jobs",
        purpose: "Compare the current role with one or two explicitly selected technology roles.",
        readOnly: false,
      },
    ],
  },
  {
    route: "/compare",
    title: "Comparison",
    tools: [
      {
        name: "get_comparison",
        purpose: "Read the complete source-backed comparison that is visible on the current page.",
        readOnly: true,
      },
      {
        name: "remove_job_from_comparison",
        purpose:
          "Remove one selected role from the current local comparison and update its visible URL.",
        readOnly: false,
      },
      {
        name: "add_job_to_comparison",
        purpose: "Add one more role to the current comparison and update its shareable URL.",
        readOnly: false,
      },
    ],
  },
  {
    route: "/saved",
    title: "Saved searches",
    tools: [
      {
        name: "enable_workspace_recovery",
        purpose: "Optionally add passwordless recovery to the current private Jobbbler workspace.",
        readOnly: false,
      },
      {
        name: "recover_jobbbler_workspace",
        purpose:
          "Restore applications and saved searches with an email and one-time code from the person.",
        readOnly: false,
      },
      {
        name: "save_job_search",
        purpose: "Save reusable search criteria without asking for email or enabling updates.",
        readOnly: false,
      },
      {
        name: "get_saved_alerts",
        purpose: "Page through saved searches and their optional update schedules.",
        readOnly: true,
      },
      {
        name: "request_search_alert",
        purpose:
          "Prepare Jobbbler-managed email updates that continue after the browser closes, then request one explicit decision.",
        readOnly: false,
      },
      {
        name: "decide_search_alert",
        purpose: "Record the exact decision and activate only the reviewed email updates.",
        readOnly: false,
      },
      {
        name: "set_job_alert_state",
        purpose: "Pause, resume, or permanently delete one saved job search in this workspace.",
        readOnly: false,
      },
      {
        name: "open_saved_search",
        purpose: "Open one saved search on the results page with its exact stored criteria.",
        readOnly: false,
      },
      {
        name: "get_latest_search_update",
        purpose:
          "Page through what changed since a saved search was last checked, not the full result list.",
        readOnly: true,
      },
    ],
  },
  {
    route: "/apply/:draftId",
    title: "Apply",
    note: "Discoverable on every page and state-gated at execution. In the agent flow, decisions stay in the agent client and Jobbbler stores the resulting consent evidence.",
    tools: [
      {
        name: "get_applications",
        purpose: "List private applications and receipt availability without returning answers.",
        readOnly: true,
      },
      {
        name: "get_application_readiness",
        purpose: "Check what one private application still needs without returning its answers.",
        readOnly: true,
      },
      {
        name: "request_application_assistance",
        purpose: "Ask once for short-lived permission to prepare one private application.",
        readOnly: false,
      },
      {
        name: "decide_application_assistance",
        purpose: "Approve, decline, or withdraw exact request-bound application assistance.",
        readOnly: false,
      },
      {
        name: "propose_application_updates",
        purpose: "Prepare several truthful answers from facts the person supplied.",
        readOnly: false,
      },
      {
        name: "request_submission_review",
        purpose: "Freeze one exact visible application review and return its decision reference.",
        readOnly: false,
      },
      {
        name: "decide_application_submission",
        purpose: "Record the decision, store consent evidence, and submit once if approved.",
        readOnly: false,
      },
      {
        name: "withdraw_application_consent",
        purpose: "Stop future consent-based processing for one application in a single action.",
        readOnly: false,
      },
    ],
  },
];
