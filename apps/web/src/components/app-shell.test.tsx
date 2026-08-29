import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppFooter, AppHeaderSurface } from "./app-shell";

describe("AppHeaderSurface", () => {
  it("keeps human navigation simple and exposes one clear Agent view control", () => {
    const markup = renderToStaticMarkup(
      <AppHeaderSurface
        agentOpen={false}
        agentStatus="ready"
        agentStatusLabel="24 tools ready"
        onAgentToggle={vi.fn()}
        pathname="/"
      />,
    );

    expect(markup).toContain("Jobs");
    expect(markup).toContain("Alerts");
    expect(markup).toContain("Applications");
    expect(markup).toContain("Agent view");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("24 tools ready");
    expect(markup).toContain('href="/jobs"');
    expect(markup).toContain('aria-label="Jobbbler home"');
    expect(markup).not.toContain("Find once. Stay updated.");
    expect(markup).not.toContain("Works with agents");
    expect(markup).not.toContain("Agent layer");
  });

  it("keeps secondary explanation and source links in a quiet footer", () => {
    const markup = renderToStaticMarkup(<AppFooter />);

    expect(markup).toContain("How it works");
    expect(markup).toContain("Source code");
    expect(markup).toContain("© 2026 Jobbbler");
  });
});
