import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppHeaderSurface } from "./app-shell";

describe("AppHeaderSurface", () => {
  it("keeps human navigation simple and exposes one clear Agent view control", () => {
    const markup = renderToStaticMarkup(
      <AppHeaderSurface
        agentOpen={false}
        agentStatus="ready"
        agentStatusLabel="7 tools ready"
        onAgentToggle={vi.fn()}
        pathname="/"
      />,
    );

    expect(markup).toContain("Jobs");
    expect(markup).toContain("Alerts");
    expect(markup).toContain("Agent view");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("7 tools ready");
    expect(markup).not.toContain("Find once. Stay updated.");
    expect(markup).not.toContain("Works with agents");
    expect(markup).not.toContain("Agent layer");
  });
});
