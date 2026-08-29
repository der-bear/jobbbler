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
      <AgentActivityRail activities={activities} webMcpAvailable />,
    );

    expect(markup).toContain("<section");
    expect(markup).toContain('aria-label="Agent activity log"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Approval needed");
    expect(markup).toContain("Finding remote product roles in Europe.");
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

    expect(markup).toContain("Waiting for an agent");
    expect(markup).toContain("Tool calls and their visible results will appear here.");
    expect(markup).toContain("Copy prompt");
  });
});
