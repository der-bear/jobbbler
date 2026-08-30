import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import WebMcpAboutPage from "./page";

describe("WebMCP explanation", () => {
  it("presents the agentic-web value in mainstream language without inventing an embedded agent", () => {
    const markup = renderToStaticMarkup(<WebMcpAboutPage />);

    expect(markup).toContain("Ask for an outcome");
    expect(markup).toContain("No separate MCP server");
    expect(markup).toContain("One request, a complete workflow");
    expect(markup).toContain("Open this Jobbbler site");
    expect(markup).toContain("compare the strongest options");
    expect(markup).toContain("show me exactly what will be submitted");
    expect(markup).toContain("Copy prompt");
    expect(markup).toContain("Search");
    expect(markup).toContain("Compare");
    expect(markup).toContain("Monitor");
    expect(markup).toContain("Apply");
    expect(markup).toContain("managed internal role");
    expect(markup).toContain("validated employer page");
    expect(markup).toContain("If no validated page is available, it stops");
    expect(markup).toContain("Proof you can see");
    expect(markup).toContain("The conversation stays in your agent client");
    expect(markup).toContain("bounded summary of each call");
    expect(markup).toContain("active browser-registered tools");
    expect(markup).toContain("Jobbbler keeps checking after the tab closes");
    expect(markup).toContain("You approve the important parts");
    expect(markup).toContain("Only you can");
    expect(markup).not.toContain("Every tool, page by page");
    expect(markup).not.toContain("request_application_access");
    expect(markup).not.toContain("chat input");
  });
});
