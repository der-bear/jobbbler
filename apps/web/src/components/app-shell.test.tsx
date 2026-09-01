import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppFooter, AppHeaderSurface, MobilePrimaryNavigation } from "./app-shell";

describe("AppHeaderSurface", () => {
  it("keeps human navigation simple and exposes one clear Agent activity control", () => {
    const markup = renderToStaticMarkup(
      <AppHeaderSurface
        agentOpen={false}
        agentStatus="ready"
        agentStatusLabel="24 tools ready"
        onAgentToggle={vi.fn()}
        pathname="/"
      />,
    );

    expect(markup).toContain("Open roles");
    expect(markup).toContain("Saved searches");
    expect(markup).toContain("My applications");
    expect(markup).toContain("Agent activity");
    expect(markup).not.toContain("Agent view");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("24 tools ready");
    expect(markup).toContain('href="/jobs"');
    expect(markup).toContain('aria-label="Jobbbler home"');
    expect(markup).toMatch(/aria-label="Jobbbler home"[^>]*data-status="ready"/);
    expect(markup).not.toContain("Find once. Stay updated.");
    expect(markup).not.toContain("Works with agents");
    expect(markup).not.toContain("Agent layer");
  });

  it("keeps My applications selected while an application is open", () => {
    const markup = renderToStaticMarkup(
      <AppHeaderSurface
        agentOpen={false}
        agentStatus="ready"
        agentStatusLabel="26 tools ready"
        onAgentToggle={vi.fn()}
        pathname="/apply/application_123"
      />,
    );

    expect(markup).toMatch(/aria-current="page"[^>]*href="\/applications"/);
  });

  it("keeps secondary explanation and source links in a quiet footer", () => {
    const markup = renderToStaticMarkup(<AppFooter />);

    expect(markup).toContain("How it works");
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain("Privacy");
    expect(markup).toContain("Source code");
    expect(markup).toContain("© 2026 Jobbbler");
  });
});

describe("AppShell layout", () => {
  it("renders the fixed mobile navigation independently from the frosted header", () => {
    const markup = renderToStaticMarkup(<MobilePrimaryNavigation pathname="/saved" />);

    expect(markup).toContain('aria-label="Primary navigation"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('href="/saved"');
    expect(markup).toContain("Applications");
  });

  it("keeps centered route workspaces stretched inside the flex main", async () => {
    const css = await readFile(new URL("./app-shell.module.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.contentFrame\s*>\s*main\s*\{[^}]*inline-size:\s*100%;/su);
    expect(css).toMatch(
      /\.contentFrame\s*>\s*main\s*>\s*:not\(\.siteFooter\)\s*\{[^}]*inline-size:\s*100%;/su,
    );
  });

  it("shortens navigation before an open agent rail can crowd the header", async () => {
    const css = await readFile(new URL("./app-shell.module.css", import.meta.url), "utf8");

    expect(css).toMatch(
      /@media\s*\(max-width:\s*1600px\)[\s\S]*?\.shell\[data-agent-open="true"\][\s\S]*?\.desktopLabel\s*\{[^}]*display:\s*none;/u,
    );
  });

  it("keeps the mobile footer clear of the fixed navigation", async () => {
    const css = await readFile(new URL("./app-shell.module.css", import.meta.url), "utf8");

    expect(css).toMatch(
      /\.mobileNavigation\s*\{[^}]*inset-block-end:\s*max\(12px,\s*env\(safe-area-inset-bottom\)\);/su,
    );
    expect(css).toMatch(
      /\.siteFooter\s*\{[^}]*padding-block:\s*24px\s+calc\(96px\s*\+\s*env\(safe-area-inset-bottom\)\);/su,
    );
  });
});
