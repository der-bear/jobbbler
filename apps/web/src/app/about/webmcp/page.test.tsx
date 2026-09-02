import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import WebMcpAboutPage from "./page";

describe("WebMCP explanation", () => {
  it("presents the agentic-web value in mainstream language without inventing an embedded agent", () => {
    const markup = renderToStaticMarkup(<WebMcpAboutPage />);

    expect(markup).toContain("Search once. Let your agent handle the repetition.");
    expect(markup).toContain("No plug-in or separate server setup is needed");
    expect(markup).not.toContain("No separate MCP server");
    expect(markup).toContain("One conversation, from search to application");
    expect(markup).toContain("Open this Jobbbler site");
    expect(markup).toContain("compare the best matches");
    expect(markup).toContain("before using my personal data or submitting anything");
    expect(markup).toContain("Example request");
    expect(markup).toContain('aria-label="Copy prompt"');
    expect(markup).toContain("Search");
    expect(markup).toContain("Compare");
    expect(markup).toContain(
      "It compares the facts and explains the trade-offs using what matters to you",
    );
    expect(markup).toContain("Monitor");
    expect(markup).toContain("Apply");
    expect(markup).toContain("A window into the agent layer");
    expect(markup).toContain("shows judges and developers");
    expect(markup).toContain("Everyday visitors can ignore it");
    expect(markup).not.toContain("Agent view");
    expect(markup).toContain("The conversation stays in your agent app");
    expect(markup).toContain("No account is needed to search");
    expect(markup).toContain("getting back to saved searches and applications on another device");
    expect(markup).toContain("Bring back your saved searches and applications when you ask");
    expect(markup).not.toContain("private workspace");
    expect(markup).toContain("Jobbbler keeps checking after the tab closes");
    expect(markup).toContain("You stay in control");
    expect(markup).toContain("Stays with you");
    expect(markup).toContain("records consent to process the answers for that application");
    expect(markup).toContain("applies only to the unchanged application and recipient");
    expect(markup).toContain("If you say no at either step");
    expect(markup).toContain("Every role in this demo supports Apply on Jobbbler");
    expect(markup).not.toContain("For other roles");
    expect(markup).not.toContain("employer&#x27;s website");
    expect(markup).not.toContain("active workspace");
    expect(markup).toContain('href="/jobs"');
    expect(markup).toContain("Browse open roles");
    expect(markup).toContain('href="#one-request"');
    expect(markup).toContain("See the example request");
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
