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
  it("keeps the agent layer secondary while surfacing active work", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail activities={activities} registeredToolCount={4} webMcpAvailable />,
    );

    expect(markup).toContain("<details");
    expect(markup).toContain('open=""');
    expect(markup).toContain("Agent activity");
    expect(markup).toContain("WebMCP available");
    expect(markup).toContain("4 actions available on this page");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Approval needed");
    expect(markup).toContain("Finding remote product roles in Europe.");
    expect(markup).not.toContain("activity_550e8400");
  });

  it("collapses an idle agent layer behind plain-language disclosure", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail activities={[]} registeredToolCount={0} webMcpAvailable={false} />,
    );

    expect(markup).toContain("Agent activity");
    expect(markup).toContain("Browser mode");
    expect(markup).toContain("WebMCP unavailable");
    expect(markup).toContain("Ready for your agent.");
    expect(markup).not.toContain('open=""');
  });

  it("can open immediately when rendered inside an explicit activity sheet", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail
        activities={[]}
        initiallyExpanded
        registeredToolCount={2}
        webMcpAvailable
      />,
    );

    expect(markup).toContain('open=""');
    expect(markup).toContain("2 actions available on this page");
  });
});
