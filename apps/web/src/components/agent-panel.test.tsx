import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RegisteredToolSummary } from "./webmcp-provider";
import { AgentPanelSurface } from "./agent-panel";

const coreTools: readonly RegisteredToolSummary[] = [
  { name: "plan_job_workflow", purpose: "Plan a safe outcome.", readOnly: true },
  { name: "get_site_capabilities", purpose: "Read the capability guide.", readOnly: true },
  { name: "get_search_filters", purpose: "Read accepted filters.", readOnly: true },
  { name: "search_jobs", purpose: "Search technology roles.", readOnly: false },
  { name: "open_job_details", purpose: "Open a role.", readOnly: false },
  { name: "open_jobbbler_page", purpose: "Open a workspace.", readOnly: false },
];

describe("AgentPanelSurface", () => {
  it("starts with a concise guide and makes the capability hierarchy obvious", () => {
    const markup = renderToStaticMarkup(
      <AgentPanelSurface
        activities={[]}
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

    expect(markup).toContain("Agent layer");
    expect(markup).toContain("WebMCP ready");
    expect(markup).toContain("7 tools active. Discovery is automatic.");
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("Try it with one prompt");
    expect(markup).toContain("No setup. Every agent action stays visible.");
    expect(markup).not.toContain("request_application_access");
  });

  it("exposes a keyboard-operable resize separator with its current width", () => {
    const markup = renderToStaticMarkup(
      <AgentPanelSurface
        activities={[]}
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
});
