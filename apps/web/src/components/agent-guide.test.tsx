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

    expect(markup).toContain("Active tools");
    expect(markup).toContain("6 tools");
    expect(markup).toContain("Find");
    expect(markup).toContain("plan_job_workflow");
    expect(markup).toContain("Get the safe steps for a Jobbbler goal.");
    expect(markup).toContain("get_search_state");
    expect(markup).not.toContain("decide_application_submission");
    expect(markup).not.toContain("decide_search_alert");
    expect(markup).not.toContain("Plan job workflow");
    expect(markup).not.toContain(">Read<");
    expect(markup).not.toContain(">Action<");
    expect(markup).not.toContain("Active now");
    expect(markup).not.toContain("All capabilities");
    expect(markup).not.toContain("Available now");
  });

  it("labels the full fallback as a capability catalog when WebMCP is unavailable", () => {
    const markup = renderToStaticMarkup(<AgentTools tools={[]} webMcpAvailable={false} />);

    expect(markup).toContain("Capability catalog");
    expect(markup).toContain("26 tools");
    expect(markup).toContain("decide_application_submission");
    expect(markup).toContain("Asks the person");
    expect(markup).toContain("Relays the decision");
    expect(markup).not.toContain("Decision required");
    expect(markup).not.toContain("Active tools");
  });
});

describe("AgentGuide", () => {
  it("explains the external-agent workflow and copies a self-contained prompt", () => {
    const markup = renderToStaticMarkup(<AgentGuide />);

    expect(markup).toContain("Start in your agent chat");
    expect(markup).toContain("Copy prompt");
    expect(markup).toContain("Open this Jobbbler site");
    expect(markup).toContain("compare the best matches");
    expect(markup).toContain("before using my personal data or submitting anything");
    expect(markup).toContain("1");
    expect(markup).toContain("Share the link and say what you need");
    expect(markup).toContain("2");
    expect(markup).toContain("Let the agent search, compare, or keep checking");
    expect(markup).toContain("3");
    expect(markup).toContain("Review only when it asks to use your data or submit");
    expect(markup).toContain("safe step-by-step plan");
    expect(markup).toContain("only advises; it never takes action");
    expect(markup).toContain("What the tools handle");
    expect(markup).toContain("What stays with you");
    expect(markup).toContain("Prepare truthful answers and a short motivation note");
    expect(markup).toContain("Consent to process your data");
    expect(markup).toContain("right to withdraw it");
    expect(markup).toContain("Activity shows what happened");
    expect(markup).toContain("Tools shows all 26 capabilities");
    expect(markup).not.toContain("managed internal role");
    expect(markup).not.toContain("validated employer page");
  });
});
