import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ToolActivity } from "@jobbbler/contracts";

import { AgentActivityRail } from "./agent-activity-rail";

const activities: readonly ToolActivity[] = [
  {
    id: "activity_550e8400-e29b-41d4-a716-446655440000",
    toolName: "search_jobs",
    status: "running",
    safeSummary: "Finding remote product roles in Europe.",
    correlationId: "correlation_550e8400-e29b-41d4-a716-446655440000",
    startedAt: "2026-08-29T10:24:00.000Z",
    completedAt: null,
    affectedResourceIds: [],
  },
  {
    id: "activity_650e8400-e29b-41d4-a716-446655440000",
    toolName: "request_app_confirmation",
    status: "requires_user_action",
    safeSummary: "Your confirmation is required before submission.",
    correlationId: "correlation_650e8400-e29b-41d4-a716-446655440000",
    startedAt: "2026-08-29T10:23:00.000Z",
    completedAt: "2026-08-29T10:23:02.000Z",
    affectedResourceIds: ["draft_550e8400-e29b-41d4-a716-446655440000"],
  },
];

describe("AgentActivityRail", () => {
  it("translates legacy application receipts into the current product language", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail
        activities={[
          {
            id: "legacy-start",
            toolName: "start_application",
            status: "completed",
            safeSummary: "Application workspace created.",
            correlationId: "legacy-correlation",
            startedAt: "2026-08-29T10:23:00.000Z",
            completedAt: "2026-08-29T10:23:00.100Z",
            affectedResourceIds: [],
          },
        ]}
        webMcpAvailable
      />,
    );

    expect(markup).toContain("Application prepared.");
    expect(markup).toContain("prepare_application");
    expect(markup).not.toContain("Application workspace created.");
  });

  it("keeps the agent layer secondary while surfacing active work", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail activities={activities} webMcpAvailable />,
    );

    expect(markup).toContain("<section");
    expect(markup).toContain('aria-label="Agent activity log"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Approval needed");
    expect(markup).toContain("Finding remote product roles in Europe.");
    expect(markup).toContain("<code>search_jobs</code>");
    expect(markup).not.toContain("activity_550e8400");
  });

  it("shows a plain-language browser fallback without nested disclosures", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail activities={[]} webMcpAvailable={false} />,
    );

    expect(markup).toContain("No agent actions in this browser.");
    expect(markup).toContain("The job portal still works normally.");
    expect(markup).not.toContain("<details");
  });

  it("shows a useful empty receipt state when an agent is ready", () => {
    const markup = renderToStaticMarkup(<AgentActivityRail activities={[]} webMcpAvailable />);

    expect(markup).toContain("No agent activity yet");
    expect(markup).toContain("Tool calls and visible results will appear here.");
    expect(markup).not.toContain("Copy prompt");
  });

  it("groups repeated identical calls so the judge timeline stays readable", () => {
    const repeated = Array.from({ length: 4 }, (_, index): ToolActivity => ({
      ...activities[1]!,
      id: `activity_${String(index)}-550e8400-e29b-41d4-a716-446655440000`,
      toolName: "prepare_application",
      status: "completed",
      safeSummary: "Application workspace created.",
      startedAt: `2026-08-29T10:23:0${String(index)}.000Z`,
      completedAt: `2026-08-29T10:23:0${String(index)}.000Z`,
    }));
    const markup = renderToStaticMarkup(
      <AgentActivityRail activities={repeated} webMcpAvailable />,
    );

    expect(markup).toContain("4 calls");
    expect(markup).not.toContain("0 ms");
  });
});
