import { describe, expect, it } from "vitest";

import { MAX_WEBMCP_RESULT_BYTES, webMcpResultSize } from "@/lib/webmcp-tool-result";

import { createWorkflowPlannerTool, workflowGoals } from "./webmcp-workflows";

describe("plan_job_workflow", () => {
  it("names the required goal field and every supported outcome for weaker agents", () => {
    const planner = createWorkflowPlannerTool({
      route: "/",
      availableTools: () => [],
    });

    expect(planner.description).toContain("required goal");
    for (const goal of workflowGoals) expect(planner.description).toContain(goal);
    expect(workflowGoals).toContain("manage_saved_search");
    expect(workflowGoals).toContain("withdraw_application_consent");
    expect(planner.description).toContain("Jobbbler-managed email updates");
    expect(planner.description).toContain("not a client-side scheduler");
  });

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
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });

  it("keeps workspace recovery entirely in the external agent client", async () => {
    const planner = createWorkflowPlannerTool({
      route: "/saved",
      availableTools: () => ["recover_jobbbler_workspace", "get_applications", "get_saved_alerts"],
    });

    const result = await planner.execute(
      { goal: "recover_workspace" },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        nextTool: "recover_jobbbler_workspace",
        nextInputs: ["action=start", "verified email supplied by the person"],
        nextHumanAction: "Ask for the verified email in the agent client.",
        steps: [
          {
            intent: "Send a recovery code",
            tool: "recover_jobbbler_workspace",
            needs: ["action=start", "verified email supplied by the person"],
            ask: "Ask for the verified email in the agent client.",
          },
          {
            intent: "Complete workspace recovery",
            tool: "recover_jobbbler_workspace",
            needs: ["action=complete", "recoveryId from start", "6-digit code from the person"],
            ask: "Ask for the six-digit code in the agent client.",
          },
          {
            intent: "Confirm the restored applications",
            tool: "get_applications",
            needs: [],
          },
          {
            intent: "Confirm the restored saved searches",
            tool: "get_saved_alerts",
            needs: [],
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("Open the Saved page");
  });

  it("explains optional recovery setup without confusing it with consent or alerts", async () => {
    const planner = createWorkflowPlannerTool({
      route: "/applications",
      availableTools: () => ["enable_workspace_recovery"],
    });

    const result = await planner.execute(
      { goal: "enable_recovery" },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        nextTool: "enable_workspace_recovery",
        nextInputs: ["action=start", "email explicitly supplied by the person"],
        steps: [
          {
            intent: "Send a verification code for optional workspace recovery",
            tool: "enable_workspace_recovery",
            needs: ["action=start", "email explicitly supplied by the person"],
            ask: "Ask for an email in the agent client only if the person wants recovery.",
          },
          {
            intent: "Complete optional recovery setup",
            tool: "enable_workspace_recovery",
            needs: ["action=complete", "challengeId from start", "6-digit code from the person"],
            ask: "Ask for the six-digit code in the agent client.",
          },
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("optional");
    expect(serialized).not.toContain("consent");
    expect(serialized).not.toContain("alert subscription");
  });

  it("keeps alert setup entirely agent-native with one explicit external-client decision", async () => {
    const planner = createWorkflowPlannerTool({
      route: "/",
      availableTools: () => [
        "search_jobs",
        "get_search_state",
        "request_search_alert",
        "decide_search_alert",
        "get_saved_alerts",
        "get_latest_search_update",
        "open_saved_search",
        "set_job_alert_state",
      ],
    });

    const result = await planner.execute(
      { goal: "monitor_search" },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        nextTool: "search_jobs",
        steps: [
          expect.objectContaining({ tool: "search_jobs" }),
          expect.objectContaining({ tool: "get_search_state", needs: ["detail=exact"] }),
          expect.objectContaining({
            tool: "request_search_alert",
            needs: expect.arrayContaining(["email"]),
            ask: "Ask in chat for missing name, schedule, time zone, or email; show the exact review and ask once.",
          }),
          expect.objectContaining({
            tool: "decide_search_alert",
            needs: expect.arrayContaining([
              "requestId",
              "reviewToken",
              "6-digit code only when verificationMode=email_code",
            ]),
          }),
          expect.objectContaining({ tool: "get_saved_alerts" }),
          expect.objectContaining({ tool: "get_latest_search_update" }),
          expect.objectContaining({ tool: "open_saved_search" }),
          expect.objectContaining({
            tool: "set_job_alert_state",
            needs: ["action,target,delete-confirmation"],
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("Saved page");
  });

  it("keeps save-only requests separate from email monitoring", async () => {
    const planner = createWorkflowPlannerTool({
      route: "/jobs",
      availableTools: () => ["search_jobs", "get_search_state", "save_job_search"],
    });

    const result = await planner.execute(
      { goal: "save_search" },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        nextTool: "search_jobs",
        steps: [
          expect.objectContaining({ tool: "search_jobs" }),
          expect.objectContaining({ tool: "get_search_state", needs: ["detail=exact"] }),
          expect.objectContaining({
            tool: "save_job_search",
            needs: ["name", "criteria from get_search_state.data.criteria"],
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("Email updates stay off");
    expect(serialized).not.toContain("request_search_alert");
  });

  it("plans one direct Jobbbler-managed application path without capability preflight", async () => {
    const planner = createWorkflowPlannerTool({
      route: "/jobs/:jobId",
      availableTools: () => [
        "open_job_details",
        "get_job_details",
        "prepare_application",
        "get_application_readiness",
        "request_application_assistance",
        "decide_application_assistance",
        "propose_application_updates",
        "request_submission_review",
        "decide_application_submission",
        "withdraw_application_consent",
      ],
    });

    const result = await planner.execute(
      { goal: "prepare_application" },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        nextTool: "get_job_details",
        nextInputs: ["jobId"],
        steps: [
          {
            intent: "Read the full role",
            tool: "get_job_details",
            needs: ["jobId"],
          },
          {
            intent: "Create or reopen the application",
            tool: "prepare_application",
            needs: ["jobId"],
          },
          expect.objectContaining({
            tool: "get_application_readiness",
            needs: ["draftId from prepare_application"],
          }),
          expect.objectContaining({
            tool: "request_application_assistance",
            needs: ["draftId"],
          }),
          expect.objectContaining({
            tool: "decide_application_assistance",
            needs: ["draftId", "requestId", "decision"],
          }),
          expect.objectContaining({
            tool: "propose_application_updates",
            needs: ["draftId", "patches: fieldKey + value"],
            ask: expect.stringContaining("CV stays in the agent client"),
          }),
          expect.objectContaining({
            tool: "request_submission_review",
            needs: ["draftId"],
          }),
          expect.objectContaining({
            tool: "decide_application_submission",
            needs: ["draftId", "requestId", "draftVersion", "decision"],
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("get_job_application_capability");
    expect(JSON.stringify(result)).not.toContain("applyMode=external");
    expect(JSON.stringify(result)).not.toContain("employer page");
    expect(JSON.stringify(result)).toContain("follow its nextTool");
  });

  it("teaches management and withdrawal without overloading the main workflows", async () => {
    const planner = createWorkflowPlannerTool({
      route: "/saved",
      availableTools: () => [
        "get_saved_alerts",
        "set_job_alert_state",
        "get_application_readiness",
        "withdraw_application_consent",
      ],
    });

    const management = await planner.execute(
      { goal: "manage_saved_search" },
      { signal: new AbortController().signal },
    );
    const withdrawal = await planner.execute(
      { goal: "withdraw_application_consent" },
      { signal: new AbortController().signal },
    );

    expect(management).toMatchObject({
      status: "completed",
      data: {
        nextTool: "get_saved_alerts",
        steps: [
          expect.objectContaining({ tool: "get_saved_alerts" }),
          expect.objectContaining({ tool: "set_job_alert_state" }),
        ],
      },
    });
    expect(withdrawal).toMatchObject({
      status: "completed",
      data: {
        steps: [
          expect.objectContaining({ tool: "get_application_readiness" }),
          expect.objectContaining({ tool: "withdraw_application_consent" }),
        ],
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
        "request_search_alert",
        "decide_search_alert",
        "get_latest_search_update",
        "open_saved_search",
        "set_job_alert_state",
        "enable_workspace_recovery",
        "recover_jobbbler_workspace",
        "get_applications",
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

    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });
});
