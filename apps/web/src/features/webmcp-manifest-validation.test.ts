import { describe, expect, it } from "vitest";

import type { ApplicationAgentState } from "@jobbbler/contracts";
import { validateToolManifest } from "@jobbbler/webmcp";

import { createApplicationToolManifests } from "./application/webmcp-tools";
import { createCompareToolManifests } from "./compare/webmcp-tools";
import { createJobDetailToolManifests } from "./job-detail/webmcp-tools";
import { createSavedToolManifests } from "./saved/webmcp-tools";
import { createSearchToolManifests } from "./search/webmcp-tools";
import { createSiteWideToolManifests } from "./site-wide-webmcp-tools";
import { createWorkflowPlannerTool } from "./webmcp-workflows";

const never = () => Promise.reject(new Error("not called in validation tests"));

function applicationState(overrides: Partial<ApplicationAgentState>): ApplicationAgentState {
  return {
    draftId: "draft_550e8400-e29b-41d4-a716-446655440000",
    jobId: "job_550e8400-e29b-41d4-a716-446655440000",
    state: "draft",
    stage: "profile",
    version: 1,
    requiredFields: 5,
    completedRequiredFields: 0,
    reviewStatus: "none",
    dataPermissionStatus: "none",
    agentAuthorityStatus: "none",
    finalConfirmationReady: false,
    receiptStatus: "none",
    ...overrides,
  };
}

function applicationManifests(
  overrides: Partial<ApplicationAgentState>,
  options: Readonly<{ authorized?: boolean; allowsAgentSubmission?: boolean }> = {},
) {
  const { authorized = true, allowsAgentSubmission = true } = options;
  const state = applicationState(overrides);
  const missing = state.completedRequiredFields < state.requiredFields;
  return createApplicationToolManifests({
    currentReadiness: () => ({
      state,
      missingFieldKeys: missing ? ["full_name"] : [],
      missingFieldLabels: missing ? ["Full name"] : [],
      nextAction: state.receiptStatus !== "none" ? "complete" : missing ? "prepare" : "review",
    }),
    allowsAgentSubmission: () => allowsAgentSubmission,
    hasAgentCredential: () => authorized,
    isOperationAuthorized: () => authorized,
    requestAgentAccess: never,
    decideAgentAccess: never,
    proposeUpdates: never,
    currentSubmissionReview: () => null,
    requestSubmissionReview: () => {
      throw new Error("not called in validation tests");
    },
    decideSubmission: never,
  });
}

describe("route tool manifests", () => {
  it("the stable site-wide core passes the shared manifest contract", () => {
    const search = createSearchToolManifests({
      searchJobs: never,
      getSearchState: () => null,
      onSearchCommitted: () => undefined,
      onNavigate: () => undefined,
    });
    const siteWide = createSiteWideToolManifests({
      onNavigate: () => undefined,
      startApplication: async () => ({
        draftId: "application_00000001-0000-7000-8000-000000000001",
        href: "/apply/application_00000001-0000-7000-8000-000000000001",
        disposition: "created" as const,
        nextTool: "get_application_readiness" as const,
      }),
    });
    const candidates = [
      createWorkflowPlannerTool({ route: "/about/webmcp", availableTools: () => [] }),
      ...siteWide,
      ...search,
    ];
    const names = [
      "plan_job_workflow",
      "get_search_filters",
      "search_jobs",
      "open_job_details",
      "open_jobbbler_page",
    ];
    const core = names.map((name) => {
      const manifest = candidates.find((candidate) => candidate.name === name);
      if (manifest === undefined) throw new Error(`Missing ${name}.`);
      return manifest;
    });

    expect(core.map(({ name }) => name)).toEqual(names);
    expect(() => validateToolManifest(core)).not.toThrow();
  });

  it("every route set passes the shared manifest contract", () => {
    const routeSets = {
      search: createSearchToolManifests({
        searchJobs: never,
        getSearchState: () => null,
        onSearchCommitted: () => undefined,
        onNavigate: () => undefined,
      }),
      detail: createJobDetailToolManifests({
        currentJobId: "job_550e8400-e29b-41d4-a716-446655440000",
        getJobDetails: never,
        compareJobs: never,
        onDetailCommitted: () => undefined,
        onNavigate: () => undefined,
      }),
      compare: createCompareToolManifests({
        selectedJobIds: () => ["job_550e8400-e29b-41d4-a716-446655440000"],
        getComparison: never,
        removeJobFromComparison: never,
        onComparisonCommitted: () => undefined,
        onNavigate: () => undefined,
      }),
      saved: createSavedToolManifests({
        listSavedSearches: never,
        listSchedules: never,
        setScheduleEnabled: never,
        onScheduleCommitted: () => undefined,
        savedSearchHref: () => "/",
        getLatestRun: never,
        onNavigate: () => undefined,
      }),
    };

    for (const [route, manifests] of Object.entries(routeSets)) {
      expect(manifests.length, route).toBeGreaterThan(0);
      expect(() => validateToolManifest(manifests), route).not.toThrow();
    }
  });

  it("every application stage and authority combination passes the manifest contract", () => {
    const scenarios: readonly Readonly<{
      label: string;
      overrides: Partial<ApplicationAgentState>;
      options?: Readonly<{ authorized?: boolean; allowsAgentSubmission?: boolean }>;
    }>[] = [
      {
        label: "profile unauthorized",
        overrides: { stage: "profile" },
        options: { authorized: false },
      },
      {
        label: "profile access requested",
        overrides: { stage: "profile", agentAuthorityStatus: "requested" },
        options: { authorized: false },
      },
      {
        label: "profile authorized",
        overrides: { stage: "profile", agentAuthorityStatus: "active" },
      },
      { label: "review", overrides: { stage: "review", agentAuthorityStatus: "active" } },
      {
        label: "permission pending request",
        overrides: {
          stage: "permission",
          agentAuthorityStatus: "active",
          dataPermissionStatus: "none",
        },
      },
      {
        label: "permission awaiting approval",
        overrides: {
          stage: "permission",
          agentAuthorityStatus: "active",
          dataPermissionStatus: "requested",
        },
      },
      {
        label: "confirmation not ready",
        overrides: {
          stage: "confirmation",
          agentAuthorityStatus: "active",
          dataPermissionStatus: "active",
          finalConfirmationReady: false,
        },
      },
      {
        label: "confirmation ready internal",
        overrides: {
          stage: "confirmation",
          agentAuthorityStatus: "active",
          dataPermissionStatus: "active",
          finalConfirmationReady: true,
        },
      },
      {
        label: "confirmation ready external",
        overrides: {
          stage: "confirmation",
          agentAuthorityStatus: "active",
          dataPermissionStatus: "active",
          finalConfirmationReady: true,
        },
        options: { allowsAgentSubmission: false },
      },
      { label: "complete", overrides: { stage: "complete" } },
    ];

    for (const scenario of scenarios) {
      const manifests = applicationManifests(scenario.overrides, scenario.options);
      expect(manifests.length, scenario.label).toBeGreaterThan(0);
      expect(() => validateToolManifest(manifests), scenario.label).not.toThrow();
    }
  });
});
