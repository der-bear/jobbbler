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
  it("announces WebMCP capability and lifecycle states without exposing IDs", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail activities={activities} registeredToolCount={4} webMcpAvailable />,
    );

    expect(markup).toContain("WebMCP available");
    expect(markup).toContain("4 tools registered");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Approval needed");
    expect(markup).toContain("Finding remote product roles in Europe.");
    expect(markup).not.toContain("activity_550e8400");
  });

  it("explains the empty state when no tool has acted", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail activities={[]} registeredToolCount={0} webMcpAvailable={false} />,
    );

    expect(markup).toContain("WebMCP unavailable");
    expect(markup).toContain("No agent activity yet.");
  });
});
