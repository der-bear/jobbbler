import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { invalidSearchFiltersMessage } from "./initial-search-state";
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
    const locationIndex = markup.indexOf("City, country or region");
    const disclosureIndex = markup.indexOf("More filters");

    expect(searchIndex).toBeGreaterThan(-1);
    expect(locationIndex).toBeGreaterThan(searchIndex);
    expect(disclosureIndex).toBeGreaterThan(locationIndex);
    expect(markup).not.toContain("<details");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="advanced-search-filters-');
    expect(markup).toContain("More filters");
    /* No qualifier beside it — every filter on this page is optional. */
    expect(markup).not.toContain("Optional");
    expect(markup).toContain("Work model");
    expect(markup).toContain("Employment type");
    expect(markup).toContain("Minimum salary");
    expect(markup).toContain("Save search");
    expect(markup).not.toContain("Save alert");
    expect(markup).toContain("Recently updated");
    expect(markup).toContain("Salary: low to high");
  });

  it("offers a useful reset instead of retrying an invalid URL forever", () => {
    const markup = renderToStaticMarkup(
      <SearchWorkspace
        initialSearch={{
          ...initialSearch,
          error: invalidSearchFiltersMessage,
        }}
        mode="catalog"
      />,
    );

    expect(markup).toContain("Clear filters");
    expect(markup).not.toContain(">Retry<");
  });
});
