import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ToolActivity } from "@jobbbler/contracts";

import { AgentActivityRail, groupedActivities } from "./agent-activity-rail";

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
        webMcpStatus="ready"
      />,
    );

    expect(markup).toContain("Application prepared.");
    expect(markup).toContain("prepare_application");
    expect(markup).not.toContain("Application workspace created.");
  });

  it("removes legacy draft language from persisted activity", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail
        activities={[
          {
            ...activities[1]!,
            toolName: "edit_application",
            status: "completed",
            safeSummary: "Application draft updated.",
          },
        ]}
        webMcpStatus="ready"
      />,
    );

    expect(markup).toContain("Application updated.");
    expect(markup).not.toContain("Application draft updated.");
  });

  it("keeps the agent layer secondary while surfacing active work", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail
        activities={activities}
        onClearHistory={async () => undefined}
        webMcpStatus="ready"
      />,
    );

    expect(markup).toContain("<section");
    expect(markup).toContain('aria-label="Agent activity log"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Decision requested");
    expect(markup).not.toContain("Your decision needed");
    expect(markup).toContain("Finding remote product roles in Europe.");
    expect(markup).toContain("<code>search_jobs</code>");
    expect(markup).toContain("Clear history");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("activity_550e8400");
  });

  it("does not show a meaningless clear action for an empty history", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail
        activities={[]}
        onClearHistory={async () => undefined}
        webMcpStatus="ready"
      />,
    );

    expect(markup).not.toContain("Clear history");
  });

  it("shows a plain-language browser fallback without nested disclosures", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail activities={[]} webMcpStatus="unsupported" />,
    );

    expect(markup).toContain("No agent activity in this browser");
    expect(markup).toContain("Open Jobbbler in a WebMCP-compatible agent client to use the tools.");
    expect(markup).not.toContain("<details");
  });

  it("does not claim tools are off while registration is still preparing", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail activities={[]} webMcpStatus="preparing" />,
    );

    expect(markup).toContain("Getting agent tools ready");
    expect(markup).toContain("Tool calls will appear here as soon as setup finishes.");
    expect(markup).not.toContain("tools are off");
  });

  it("shows a useful empty receipt state when an agent is ready", () => {
    const markup = renderToStaticMarkup(<AgentActivityRail activities={[]} webMcpStatus="ready" />);

    expect(markup).toContain("No agent activity yet");
    expect(markup).toContain(
      "Start a task in a compatible agent client. Each Jobbbler tool call will appear here.",
    );
    expect(markup).not.toContain("Copy prompt");
  });

  it("offers a direct path to the guide from an empty panel", () => {
    const markup = renderToStaticMarkup(
      <AgentActivityRail activities={[]} onOpenGuide={() => undefined} webMcpStatus="ready" />,
    );

    expect(markup).toContain("Open guide");
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
      <AgentActivityRail activities={repeated} webMcpStatus="ready" />,
    );

    expect(markup).toContain("4 similar calls grouped");
    expect(markup).not.toContain("1 similar calls grouped");
    expect(markup).not.toContain("0 ms");
  });

  it("explains when earlier activity is hidden and offers a way to reveal it", () => {
    const distinct = Array.from({ length: 6 }, (_, index): ToolActivity => ({
      ...activities[0]!,
      id: `activity_${String(index)}-550e8400-e29b-41d4-a716-446655440000`,
      correlationId: `correlation_${String(index)}-550e8400-e29b-41d4-a716-446655440000`,
      safeSummary: `Search ${String(index + 1)} completed.`,
      status: "completed",
      completedAt: `2026-08-29T10:24:0${String(index)}.500Z`,
    }));
    const markup = renderToStaticMarkup(
      <AgentActivityRail activities={distinct} maxItems={4} webMcpStatus="ready" />,
    );

    expect(markup).toContain("Showing the 4 most recent actions.");
    expect(markup).toContain("Show 2 earlier");
  });

  it("keeps identical application calls separate when they affect different drafts", () => {
    const first = {
      ...activities[1]!,
      id: "activity_750e8400-e29b-41d4-a716-446655440000",
      toolName: "edit_application",
      status: "completed" as const,
      safeSummary: "Application draft updated.",
      affectedResourceIds: ["draft_750e8400-e29b-41d4-a716-446655440000"],
    };
    const second: ToolActivity = {
      ...first,
      id: "activity_850e8400-e29b-41d4-a716-446655440000",
      correlationId: "correlation_850e8400-e29b-41d4-a716-446655440000",
      affectedResourceIds: ["draft_850e8400-e29b-41d4-a716-446655440000"],
    };

    expect(groupedActivities([first, second])).toHaveLength(2);
  });

  it("groups identical retries that affect the same application draft", () => {
    const first = {
      ...activities[1]!,
      id: "activity_950e8400-e29b-41d4-a716-446655440000",
      toolName: "edit_application",
      status: "completed" as const,
      safeSummary: "Application draft updated.",
      affectedResourceIds: ["draft_950e8400-e29b-41d4-a716-446655440000"],
    };
    const retry: ToolActivity = {
      ...first,
      id: "activity_a50e8400-e29b-41d4-a716-446655440000",
      correlationId: "correlation_a50e8400-e29b-41d4-a716-446655440000",
    };

    expect(groupedActivities([first, retry])).toMatchObject([
      { count: 2, activity: { ...retry, safeSummary: "Application updated." } },
    ]);
  });

  it("uses correlation to distinguish otherwise identical calls without resources", () => {
    const first: ToolActivity = {
      ...activities[0]!,
      status: "completed",
      safeSummary: "Search completed.",
      completedAt: "2026-08-29T10:24:01.000Z",
      affectedResourceIds: [],
    };
    const differentRequest: ToolActivity = {
      ...first,
      id: "activity_b50e8400-e29b-41d4-a716-446655440000",
      correlationId: "correlation_b50e8400-e29b-41d4-a716-446655440000",
    };
    const sameRequest: ToolActivity = {
      ...first,
      id: "activity_c50e8400-e29b-41d4-a716-446655440000",
    };

    expect(groupedActivities([first, differentRequest])).toHaveLength(2);
    expect(groupedActivities([first, sameRequest])).toMatchObject([
      { count: 2, activity: sameRequest },
    ]);
  });
});
