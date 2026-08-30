import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import WebMcpAboutPage from "./page";

describe("WebMCP explanation", () => {
  it("presents the agentic-web value in mainstream language without inventing an embedded agent", () => {
    const markup = renderToStaticMarkup(<WebMcpAboutPage />);

    expect(markup).toContain("Search once. Let your agent handle the repetition.");
    expect(markup).toContain("No separate MCP server");
    expect(markup).toContain("One conversation, from search to application");
    expect(markup).toContain("Open this Jobbbler site");
    expect(markup).toContain("compare the best matches");
    expect(markup).toContain("before using my personal data or submitting anything");
    expect(markup).toContain("Example request");
    expect(markup).toContain(">Copy prompt</button>");
    expect(markup).toContain("Search");
    expect(markup).toContain("Compare");
    expect(markup).toContain("Monitor");
    expect(markup).toContain("Apply");
    expect(markup).toContain("employer&#x27;s application page");
    expect(markup).toContain("See what happened");
    expect(markup).toContain("The conversation stays in your agent app");
    expect(markup).toContain("No account is needed to search");
    expect(markup).toContain("Jobbbler keeps checking after the tab closes");
    expect(markup).toContain("You stay in control");
    expect(markup).toContain("Stays with you");
    expect(markup).toContain("Opening the site gives an agent no access to your private data");
    expect(markup).not.toContain("managed internal role");
    expect(markup).not.toContain("validated employer page");
    expect(markup).not.toContain("browser-registered tools");
    expect(markup).not.toContain("bounded summary");
    expect(markup).not.toContain("Only you can");
    expect(markup).not.toContain("Every tool, page by page");
    expect(markup).not.toContain("request_application_access");
    expect(markup).not.toContain("chat input");
  });
});
