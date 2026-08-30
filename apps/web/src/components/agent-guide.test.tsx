import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentGuide, AgentTools } from "./agent-guide";

describe("AgentTools", () => {
  it("shows one grouped, non-duplicated list of the globally available capabilities", () => {
    const markup = renderToStaticMarkup(
      <AgentTools
        tools={[
          { name: "plan_job_workflow", purpose: "Plan an outcome.", readOnly: true },
          { name: "get_search_filters", purpose: "Read filters.", readOnly: true },
          { name: "search_jobs", purpose: "Search roles.", readOnly: false },
          { name: "open_job_details", purpose: "Open a role.", readOnly: false },
          { name: "open_jobbbler_page", purpose: "Open a workspace.", readOnly: false },
          { name: "get_search_state", purpose: "Read visible filters.", readOnly: true },
        ]}
        webMcpAvailable
      />,
    );

    expect(markup).toContain("Available tools");
    expect(markup).toContain("24 tools");
    expect(markup).toContain("Find");
    expect(markup).toContain("Inspect and compare");
    expect(markup).toContain("Alerts");
    expect(markup).toContain("Apply");
    expect(markup).toContain("plan_job_workflow");
    expect(markup).toContain("Get the safe steps for a Jobbbler goal.");
    expect(markup).toContain("managed internal role");
    expect(markup).toContain("Human decision");
    expect(markup).toContain("get_search_state");
    expect(markup).toContain("decide_application_submission");
    expect(markup).not.toContain("Plan job workflow");
    expect(markup).not.toContain(">Read<");
    expect(markup).not.toContain(">Action<");
    expect(markup).not.toContain("Active now");
    expect(markup).not.toContain("All capabilities");
    expect(markup).not.toContain("Available now");
  });
});

describe("AgentGuide", () => {
  it("explains the external-agent workflow and copies a self-contained prompt", () => {
    const markup = renderToStaticMarkup(<AgentGuide />);

    expect(markup).toContain("Use Jobbbler from your agent chat");
    expect(markup).toContain("Copy prompt");
    expect(markup).toContain("Open this Jobbbler site");
    expect(markup).toContain("compare the strongest options");
    expect(markup).toContain("check how it accepts applications");
    expect(markup).toContain("managed internal role");
    expect(markup).toContain("validated employer page");
    expect(markup).toContain("otherwise stop");
    expect(markup).toContain("show me exactly what will be submitted");
    expect(markup).toContain("1");
    expect(markup).toContain("Copy the complete request");
    expect(markup).toContain("2");
    expect(markup).toContain("Paste it into your agent client");
    expect(markup).toContain("3");
    expect(markup).toContain("Review the exact application in your agent client");
    expect(markup).toContain("What the tools handle");
    expect(markup).toContain("What stays with you");
    expect(markup).toContain("Prepare answers and a short motivation note");
    expect(markup).toContain("Consent to process your data");
    expect(markup).toContain("right to withdraw it");
  });
});
