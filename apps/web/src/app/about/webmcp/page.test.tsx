import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import WebMcpAboutPage from "./page";

describe("WebMCP explanation", () => {
  it("presents the agentic-web value in mainstream language without inventing an embedded agent", () => {
    const markup = renderToStaticMarkup(<WebMcpAboutPage />);

    expect(markup).toContain("Ask for an outcome");
    expect(markup).toContain("No separate MCP server");
    expect(markup).toContain("The site becomes the interface");
    expect(markup).toContain("Proof you can see");
    expect(markup).toContain("The conversation stays in your agent client");
    expect(markup).toContain("Jobbbler keeps checking after the tab closes");
    expect(markup).toContain("The person stays in control");
    expect(markup).not.toContain("Every tool, page by page");
    expect(markup).not.toContain("request_application_access");
    expect(markup).not.toContain("chat input");
  });
});
