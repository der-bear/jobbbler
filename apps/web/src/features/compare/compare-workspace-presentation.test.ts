import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("comparison workspace presentation", () => {
  it("keeps three role columns readable with native horizontal scroll snapping", async () => {
    const css = await readFile(new URL("./compare-workspace.module.css", import.meta.url), "utf8");

    expect(css).toMatch(
      /\.tableScroll\s*\{[^}]*overflow-x:\s*auto;[^}]*scroll-snap-type:\s*inline mandatory;/su,
    );
    expect(css).toMatch(
      /\.tableScroll\[data-columns="3"\]\s+\.comparisonTable\s*\{[^}]*min-inline-size:\s*max\(100%, 1240px\);/su,
    );
    expect(css).toMatch(
      /\.comparisonTable thead th:not\(:first-child\),\s*\.comparisonTable td\s*\{[^}]*scroll-snap-align:\s*start;[^}]*scroll-snap-stop:\s*always;/su,
    );
    expect(css).toMatch(
      /\.comparisonTable thead th:first-child,\s*\.comparisonTable tbody th\s*\{[^}]*position:\s*sticky;[^}]*inset-inline-start:\s*0;/su,
    );
  });

  it("uses stacked comparison cards at phone widths instead of squeezing the table", async () => {
    const css = await readFile(new URL("./compare-workspace.module.css", import.meta.url), "utf8");

    expect(css).toMatch(
      /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.tableScroll\s*\{[^}]*display:\s*none;[\s\S]*?\.mobileComparison\s*\{[^}]*display:\s*grid;/u,
    );
  });
});
