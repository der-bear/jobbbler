import { describe, expect, it } from "vitest";

import { MAX_WEBMCP_RESULT_BYTES, webMcpResultSize } from "@/lib/webmcp-tool-result";

import { createWorkflowPlannerTool, workflowGoals } from "./webmcp-workflows";

describe("plan_job_workflow", () => {
  it("reads the current page when invoked instead of capturing a stale registration route", async () => {
    let route = "/";
    const planner = createWorkflowPlannerTool({
      route: () => route,
      availableTools: () => ["search_jobs", "get_job_details"],
    });
    route = "/jobs/:jobId";

    const result = await planner.execute(
      { goal: "find_roles" },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        currentRoute: "/jobs/:jobId",
        nextTool: "get_job_details",
        nextInputs: ["jobId"],
      },
    });
  });

  it.each([
    ["/compare", "compare_roles", "get_comparison"],
    ["/saved", "monitor_search", "get_saved_alerts"],
    ["/apply/:draftId", "prepare_application", "get_application_readiness"],
  ] as const)("starts %s workflows from the visible workspace", async (route, goal, nextTool) => {
    const planner = createWorkflowPlannerTool({
      route,
      availableTools: () => [nextTool],
    });

    const result = await planner.execute({ goal }, { signal: new AbortController().signal });

    expect(result).toMatchObject({ status: "completed", data: { nextTool } });
  });

  it("keeps recovery on its human verification step before reading private alerts", async () => {
    const planner = createWorkflowPlannerTool({
      route: "/saved",
      availableTools: () => ["get_saved_alerts"],
    });

    const result = await planner.execute(
      { goal: "recover_workspace" },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        nextTool: null,
        nextInputs: [],
        nextHumanAction:
          "Open the Saved page and use “Restore with email”; enter the one-time code.",
        steps: [
          {
            intent: "Restore with the verified email",
            tool: null,
            needs: [],
            ask: "Open the Saved page and use “Restore with email”; enter the one-time code.",
          },
          {
            intent: "Confirm the restored alerts",
            tool: "get_saved_alerts",
            needs: [],
          },
        ],
      },
    });
  });

  it("branches managed and external applications after the capability check", async () => {
    const planner = createWorkflowPlannerTool({
      route: "/jobs/:jobId",
      availableTools: () => [
        "open_job_details",
        "get_job_application_capability",
        "prepare_application",
      ],
    });

    const result = await planner.execute(
      { goal: "prepare_application" },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        nextTool: "get_job_application_capability",
        nextInputs: ["jobId"],
        steps: expect.arrayContaining([
          {
            intent: "Check application capability",
            tool: "get_job_application_capability",
            needs: ["jobId"],
          },
        ]),
        branches: expect.arrayContaining([
          {
            when: "applyMode=internal",
            steps: expect.arrayContaining([
              {
                intent: "Prepare the internal application",
                tool: "prepare_application",
                needs: ["jobId"],
              },
            ]),
          },
          {
            when: "applyMode=external and employerSite.available=true",
            steps: [
              {
                intent: "Open the validated employer page",
                tool: null,
                needs: [],
                ask: "Open validated HTTPS employer page; create no draft or submission claim.",
              },
            ],
          },
          {
            when: "applyMode=external and employerSite.available=false",
            steps: [
              {
                intent: "Stop: employer page unavailable",
                tool: null,
                needs: [],
                ask: "Stop: no validated HTTPS employer page; no draft or submission claim.",
              },
            ],
          },
        ]),
      },
    });
  });

  it.each(workflowGoals)("keeps the %s plan inside the WebMCP output budget", async (goal) => {
    const planner = createWorkflowPlannerTool({
      route: "/",
      availableTools: () => [
        "get_search_filters",
        "search_jobs",
        "get_search_state",
        "open_job_details",
        "get_job_details",
        "compare_jobs",
        "get_comparison",
        "add_job_to_comparison",
        "get_saved_alerts",
        "get_latest_search_update",
        "open_saved_search",
        "set_job_alert_state",
        "get_job_application_capability",
        "prepare_application",
        "get_application_readiness",
        "request_application_assistance",
        "decide_application_assistance",
        "propose_application_updates",
        "request_submission_review",
        "decide_application_submission",
      ],
    });

    const result = await planner.execute({ goal }, { signal: new AbortController().signal });

    expect(webMcpResultSize(result)).toBeLessThanOrEqual(
      goal === "prepare_application" ? 2_048 : MAX_WEBMCP_RESULT_BYTES,
    );
  });
});
