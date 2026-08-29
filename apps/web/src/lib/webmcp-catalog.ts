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
    note: "A compact core keeps every workflow discoverable and reachable; page and state tools join it only when useful.",
    tools: [
      {
        name: "plan_job_workflow",
        purpose: "Return the recommended safe steps for one Jobbbler goal from the current page.",
        readOnly: true,
      },
      {
        name: "get_site_capabilities",
        purpose:
          "Read Jobbbler's workflows, tool coverage, route requirements, and human boundaries.",
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
          "Open a known role from any page so its source-backed detail tools become available.",
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
    title: "Application",
    note: "State-gated: only the two or three tools that fit the current application step are registered at any moment. Approval tools accept only a pending request ID plus the user's explicit decision made in the agent client.",
    tools: [
      {
        name: "get_application_state",
        purpose: "Read the current private application's workflow state without candidate answers.",
        readOnly: true,
      },
      {
        name: "request_application_access",
        purpose: "Request the minimum agent authority needed for the current application stage.",
        readOnly: false,
      },
      {
        name: "approve_application_access",
        purpose: "Record the user's agent-mediated approval of the pending application authority.",
        readOnly: false,
      },
      {
        name: "set_application_answer",
        purpose:
          "Suggest one answer in the current application for the candidate to accept or edit.",
        readOnly: false,
      },
      {
        name: "validate_application",
        purpose: "Validate accepted candidate facts in the current application draft.",
        readOnly: false,
      },
      {
        name: "review_application",
        purpose: "Seal the validated application into an immutable review snapshot.",
        readOnly: false,
      },
      {
        name: "request_data_permission",
        purpose: "Request human permission for the exact reviewed application disclosure.",
        readOnly: false,
      },
      {
        name: "approve_data_permission",
        purpose: "Record explicit agent-mediated permission for the exact reviewed disclosure.",
        readOnly: false,
      },
      {
        name: "request_final_confirmation",
        purpose: "Ask the candidate for a fresh final confirmation of the sealed application.",
        readOnly: true,
      },
      {
        name: "confirm_reviewed_application",
        purpose: "Record the user's final agent-mediated confirmation of the sealed application.",
        readOnly: false,
      },
      {
        name: "submit_application",
        purpose: "Submit the current sealed application using its fresh human confirmation.",
        readOnly: false,
      },
      {
        name: "prepare_external_handoff",
        purpose:
          "Leave an external application ready for the candidate to open from the visible workspace.",
        readOnly: false,
      },
    ],
  },
];
