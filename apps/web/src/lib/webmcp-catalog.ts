/**
 * Human-readable catalog of every WebMCP tool Jobbbler can register, grouped by
 * the page that owns it. This is judge- and developer-facing reference copy;
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
        purpose: "Search the public technology-job catalog and synchronize the visible results.",
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
        purpose: "Create or reopen one private application draft for an explicitly chosen role.",
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
        name: "get_job_application_capability",
        purpose: "Learn how the role on this page accepts applications before starting one.",
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
        name: "get_saved_alerts",
        purpose:
          "Read the current owner's saved searches and alert states without delivery details.",
        readOnly: true,
      },
      {
        name: "set_job_alert_state",
        purpose: "Pause or resume one existing saved job alert in the current private workspace.",
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
          "Read what changed since a saved search was last checked, not the full result list.",
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
        purpose: "Record the person's assistance decision from the agent client.",
        readOnly: false,
      },
      {
        name: "propose_application_updates",
        purpose: "Prepare several truthful answers from facts the person supplied.",
        readOnly: false,
      },
      {
        name: "request_submission_review",
        purpose: "Present one exact completed application for a decision in the agent client.",
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
