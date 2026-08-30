import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SearchWorkspace } from "./search-workspace";

const initialSearch = {
  input: { sort: "newest" as const, limit: 20 },
  result: null,
  error: null,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/webmcp-provider", () => ({
  useWebMcp: () => ({ activities: [] }),
}));

describe("SearchFilters", () => {
  it("keeps search and location visible while grouping optional filters for small screens", () => {
    const markup = renderToStaticMarkup(
      <SearchWorkspace initialSearch={initialSearch} mode="catalog" />,
    );

    const searchIndex = markup.indexOf("Role, skill or company");
    const locationIndex = markup.indexOf("City, country, or remote");
    const disclosureIndex = markup.indexOf("More filters");

    expect(searchIndex).toBeGreaterThan(-1);
    expect(locationIndex).toBeGreaterThan(searchIndex);
    expect(disclosureIndex).toBeGreaterThan(locationIndex);
    expect(markup).not.toContain("<details");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="advanced-search-filters-');
    expect(markup).toContain("More filters");
    expect(markup).toContain("Optional");
    expect(markup).toContain("Work model");
    expect(markup).toContain("Minimum salary");
  });
});
