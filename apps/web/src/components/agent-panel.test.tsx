import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RegisteredToolSummary } from "./webmcp-provider";
import { AgentPanelSurface, maximumAgentPanelWidth } from "./agent-panel";

const coreTools: readonly RegisteredToolSummary[] = [
  { name: "plan_job_workflow", purpose: "Plan a safe outcome.", readOnly: true },
  { name: "get_search_filters", purpose: "Read accepted filters.", readOnly: true },
  { name: "search_jobs", purpose: "Search technology roles.", readOnly: false },
  { name: "open_job_details", purpose: "Open a role.", readOnly: false },
  { name: "open_jobbbler_page", purpose: "Open a workspace.", readOnly: false },
];

describe("AgentPanelSurface", () => {
  it("keeps a readable main column while allowing the full panel on wide screens", () => {
    // 960 is the sheet breakpoint: panel 320 + page 640. One pixel above it the resizer has a range.
    expect(maximumAgentPanelWidth(961)).toBe(321);
    expect(maximumAgentPanelWidth(1081)).toBe(441);
    expect(maximumAgentPanelWidth(1100)).toBe(460);
    expect(maximumAgentPanelWidth(1240)).toBe(560);
    expect(maximumAgentPanelWidth(1440)).toBe(560);
  });

  it("starts with Activity and keeps the technical proof hierarchy obvious", () => {
    const markup = renderToStaticMarkup(
      <AgentPanelSurface
        activities={[]}
        onClearActivities={vi.fn()}
        onClose={vi.fn()}
        onWidthChange={vi.fn()}
        registeredTools={[
          ...coreTools,
          {
            name: "get_search_state",
            purpose: "Read the visible search.",
            readOnly: true,
          },
        ]}
        retry={vi.fn()}
        status="ready"
        supported
        width={380}
      />,
    );

    expect(markup).toContain("What your agent is doing");
    expect(markup).not.toContain("Agent view");
    expect(markup).toContain("WebMCP ready");
    expect(markup).toContain("6 tools active. Discovery is automatic.");
    expect(markup.indexOf('id="agent-tab-activity"')).toBeLessThan(
      markup.indexOf('id="agent-tab-tools"'),
    );
    expect(markup.indexOf('id="agent-tab-tools"')).toBeLessThan(
      markup.indexOf('id="agent-tab-guide"'),
    );
    expect(markup).toContain('aria-controls="agent-panel-activity" aria-selected="true"');
    expect(markup).toContain("No agent activity yet");
    expect(markup).toContain(
      "Start a task in a compatible agent client. Each Jobbbler tool call will appear here.",
    );
    /* The Guide tab in the header is the route there; a button beside it was a
       second control for the same destination. */
    expect(markup).not.toContain("Open guide");
  });

  it("keeps the full catalog visible without claiming tools are active while registration prepares", () => {
    const markup = renderToStaticMarkup(
      <AgentPanelSurface
        activities={[]}
        onClearActivities={vi.fn()}
        onClose={vi.fn()}
        onWidthChange={vi.fn()}
        registeredTools={coreTools}
        retry={vi.fn()}
        status="preparing"
        supported
        width={380}
      />,
    );

    expect(markup).toContain("Preparing agent tools");
    expect(markup).toContain("Getting agent tools ready");
    expect(markup).not.toContain("tools are off");
    expect(markup).toContain("Capability catalog");
    expect(markup).toContain("29 tools");
    expect(markup).not.toContain("Active tools");
  });

  it("exposes a keyboard-operable resize separator with its current width", () => {
    const markup = renderToStaticMarkup(
      <AgentPanelSurface
        activities={[]}
        onClearActivities={vi.fn()}
        onClose={vi.fn()}
        onWidthChange={vi.fn()}
        registeredTools={coreTools}
        retry={vi.fn()}
        status="ready"
        supported
        width={420}
      />,
    );

    expect(markup).toContain('role="separator"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toContain('aria-valuenow="420"');
    expect(markup).toContain('tabindex="0"');
  });

  it("removes the hidden desktop resizer from the mobile dialog tab order", () => {
    const markup = renderToStaticMarkup(
      <AgentPanelSurface
        activities={[]}
        onClearActivities={vi.fn()}
        modal
        onClose={vi.fn()}
        onWidthChange={vi.fn()}
        registeredTools={coreTools}
        retry={vi.fn()}
        status="ready"
        supported
        width={380}
      />,
    );

    expect(markup).toMatch(/aria-label="Resize agent panel"[^>]*tabindex="-1"/);
  });
});
