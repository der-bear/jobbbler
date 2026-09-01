import { describe, expect, it } from "vitest";

import type { JobSummary, SearchJobsResult, ToolActivity } from "@jobbbler/contracts";

import {
  createLatestSearchCommit,
  deriveSearchPresentation,
  searchSortAfterQueryChange,
  searchWorkspaceHref,
  shouldPulseResultsForActivity,
} from "./search-workspace";

function job(index: number): JobSummary {
  return {
    id: `job_${String(index).padStart(8, "0")}`,
    organizationId: `org_${String(index).padStart(8, "0")}`,
    organizationName: `Company ${String(index)}`,
    title: `Role ${String(index)}`,
    summary: "A source-backed technology role.",
    categories: ["software_engineering"],
    workModel: "remote",
    employmentType: "full_time",
    seniority: "senior",
    locations: ["Europe"],
    skills: ["TypeScript"],
    salary: null,
    source: { key: "demo", label: "Demo", url: null },
    applyMode: "internal",
    status: "open",
    publishedAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
  };
}

function result(count: number): SearchJobsResult {
  return {
    jobs: Array.from({ length: count }, (_, index) => job(index)),
    total: count,
    nextCursor: null,
    criteria: {
      query: null,
      categories: [],
      workModels: [],
      seniorities: [],
      locations: [],
      skills: [],
      excludeKeywords: [],
      salary: null,
      postedWithinDays: null,
      sort: "newest",
      cursor: null,
      limit: 20,
      unresolvedAssumptions: [],
    },
    catalogUpdatedAt: "2026-08-29T10:00:00.000Z",
    warnings: [],
  };
}

describe("deriveSearchPresentation", () => {
  it("keeps the Home URL canonical while Jobs owns filter URLs", () => {
    const input = { query: "platform", sort: "newest" as const, limit: 20 };

    expect(searchWorkspaceHref(input, "home")).toBe("/");
    expect(searchWorkspaceHref(input, "catalog")).toBe("/jobs?q=platform&sort=newest");
  });

  it("keeps the start screen focused and limits its latest-role preview", () => {
    const presentation = deriveSearchPresentation({ sort: "newest", limit: 20 }, result(8), "home");

    expect(presentation.landing).toBe(true);
    expect(presentation.showHeroSearch).toBe(true);
    expect(presentation.resultLayout).toBe("cards");
    expect(presentation.showFilters).toBe(false);
    expect(presentation.heading).toBe("Latest technology roles");
    expect(presentation.visibleJobs).toHaveLength(6);
  });

  it("opens Jobs as the full catalog with filters even before a search", () => {
    const presentation = deriveSearchPresentation(
      { sort: "newest", limit: 20 },
      result(8),
      "catalog",
    );

    expect(presentation.landing).toBe(false);
    expect(presentation.showHeroSearch).toBe(false);
    expect(presentation.resultLayout).toBe("list");
    expect(presentation.showFilters).toBe(true);
    expect(presentation.heading).toBe("8 roles");
    expect(presentation.visibleJobs).toHaveLength(8);
  });

  it("shows the complete result workspace after a meaningful search", () => {
    const presentation = deriveSearchPresentation(
      { query: "platform", locations: ["Europe"], sort: "newest", limit: 20 },
      result(8),
    );

    expect(presentation.landing).toBe(false);
    expect(presentation.showFilters).toBe(true);
    expect(presentation.heading).toBe("8 matches");
    expect(presentation.visibleJobs).toHaveLength(8);
  });

  it("uses singular result copy for one matching role", () => {
    const presentation = deriveSearchPresentation(
      { locations: ["Phoenix, United States"], sort: "newest", limit: 20 },
      result(1),
    );

    expect(presentation.heading).toBe("1 match");
  });

  it("uses singular catalog copy for one role", () => {
    const presentation = deriveSearchPresentation(
      { sort: "newest", limit: 20 },
      result(1),
      "catalog",
    );

    expect(presentation.heading).toBe("1 role");
  });

  it("treats a freshness filter as a search even without text", () => {
    const presentation = deriveSearchPresentation(
      { postedWithinDays: 7, sort: "newest", limit: 20 },
      result(3),
    );

    expect(presentation.landing).toBe(false);
    expect(presentation.showFilters).toBe(true);
  });
});

describe("deferred text filter commits", () => {
  it("switches the first text query from catalog recency to best match", () => {
    expect(
      searchSortAfterQueryChange(
        { sort: "newest", limit: 20 },
        { query: "security", sort: "newest", limit: 20 },
      ),
    ).toBe("relevance");
  });

  it("preserves a sort chosen after a query already exists", () => {
    expect(
      searchSortAfterQueryChange(
        { query: "security", sort: "newest", limit: 20 },
        { query: "security engineer", sort: "newest", limit: 20 },
      ),
    ).toBe("newest");
  });

  it("uses the latest draft and commit callback after an agent replaces the search", () => {
    let draft = "human typing";
    const calls: string[] = [];
    let commit = (value: string) => calls.push(`stale:${value}`);
    const deferred = createLatestSearchCommit(
      () => draft,
      () => commit,
    );

    draft = "agent result";
    commit = (value) => calls.push(`latest:${value}`);
    deferred();

    expect(calls).toEqual(["latest:agent result"]);
  });

  it("drops a pending human commit after an external search replaces its baseline", () => {
    const calls: string[] = [];
    const deferred = createLatestSearchCommit(
      () => "stale human query",
      () => (value: string) => calls.push(value),
      () => false,
    );

    deferred();

    expect(calls).toEqual([]);
  });
});

describe("shouldPulseResultsForActivity", () => {
  const completedSearch: ToolActivity = {
    id: "activity_00000000-0000-7000-8000-000000000001",
    toolName: "search_jobs",
    status: "completed",
    safeSummary: "12 matching roles found.",
    correlationId: "correlation_00000000-0000-7000-8000-000000000001",
    startedAt: "2026-08-30T16:00:01.000Z",
    completedAt: "2026-08-30T16:00:01.100Z",
    affectedResourceIds: [],
  };

  it("reserves the branded result sweep for a newly completed agent search", () => {
    const mountedAt = Date.parse("2026-08-30T16:00:00.000Z");

    expect(shouldPulseResultsForActivity(completedSearch, mountedAt)).toBe(true);
    expect(
      shouldPulseResultsForActivity({ ...completedSearch, toolName: "get_job_details" }, mountedAt),
    ).toBe(false);
    expect(
      shouldPulseResultsForActivity({ ...completedSearch, status: "running" }, mountedAt),
    ).toBe(false);
    expect(
      shouldPulseResultsForActivity(
        { ...completedSearch, startedAt: "2026-08-30T15:59:59.000Z" },
        mountedAt,
      ),
    ).toBe(false);
  });
});
