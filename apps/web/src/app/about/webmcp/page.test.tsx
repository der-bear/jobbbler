import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import WebMcpAboutPage from "./page";

describe("WebMCP explanation", () => {
  it("presents the agentic-web value in mainstream language without inventing an embedded agent", () => {
    const markup = renderToStaticMarkup(<WebMcpAboutPage />);

    expect(markup).toContain("A job portal your browser agent can understand");
    expect(markup).toContain("No separate MCP server");
    expect(markup).toContain("discovers the actions available on that page");
    expect(markup).toContain("The conversation stays in your agent client");
    expect(markup).toContain("Jobbbler keeps checking after the tab closes");
    expect(markup).toContain("agent-mediated approval");
    expect(markup).not.toContain("chat input");
  });
});
