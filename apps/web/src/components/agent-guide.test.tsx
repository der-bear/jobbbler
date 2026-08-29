import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentTools } from "./agent-guide";

describe("AgentTools", () => {
  it("shows what is active now and the complete grouped capability catalog", () => {
    const markup = renderToStaticMarkup(
      <AgentTools
        tools={[
          { name: "plan_job_workflow", purpose: "Plan an outcome.", readOnly: true },
          { name: "get_site_capabilities", purpose: "Read capabilities.", readOnly: true },
          { name: "get_search_filters", purpose: "Read filters.", readOnly: true },
          { name: "search_jobs", purpose: "Search roles.", readOnly: false },
          { name: "open_job_details", purpose: "Open a role.", readOnly: false },
          { name: "open_jobbbler_page", purpose: "Open a workspace.", readOnly: false },
          { name: "get_search_state", purpose: "Read visible filters.", readOnly: true },
        ]}
        webMcpAvailable
      />,
    );

    expect(markup).toContain("Active now");
    expect(markup).toContain("All capabilities");
    expect(markup).toContain("26 tools");
    expect(markup).toContain("Find");
    expect(markup).toContain("Inspect and compare");
    expect(markup).toContain("Alerts");
    expect(markup).toContain("Apply");
    expect(markup).toContain("Action");
    expect(markup).toContain("get_search_state");
    expect(markup).toContain("request_application_access");
    expect(markup).not.toContain("View all 26 tools");
  });
});
