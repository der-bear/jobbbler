import { describe, expect, it } from "vitest";

import type { JobSearchInput } from "@jobbbler/contracts";
import { normalizeJobSearchCriteria } from "@jobbbler/jobs-domain";

import { searchInputToSearchParams, searchParamsToInput } from "./search-url";

describe("shareable job-search URL state", () => {
  it("round-trips every visible filter into deterministic URL parameters", () => {
    const input = {
      query: "  platform   engineer ",
      categories: ["security", "software_engineering"],
      workModels: ["hybrid", "remote"],
      employmentTypes: ["contract", "full_time"],
      seniorities: ["staff", "senior"],
      locations: ["Europe", "Kyiv"],
      skills: ["TypeScript", "PostgreSQL"],
      excludeKeywords: ["PHP", "crypto"],
      salary: {
        minimum: 90_000,
        maximum: 160_000,
        currency: "eur",
        period: "year" as const,
        unknownPolicy: "exclude" as const,
      },
      postedWithinDays: 30,
      sort: "newest",
      cursor: "cursor-v1",
      limit: 12,
    } satisfies JobSearchInput;

    const parameters = searchInputToSearchParams(input);

    expect(parameters.toString()).toBe(
      "q=platform+engineer&category=security&category=software_engineering&work=hybrid&work=remote&employment=contract&employment=full_time&seniority=senior&seniority=staff&location=Europe&location=Kyiv&skill=PostgreSQL&skill=TypeScript&exclude=crypto&exclude=PHP&salary_min=90000&salary_max=160000&currency=EUR&unknown_salary=exclude&posted_within=30&sort=newest&cursor=cursor-v1&limit=12",
    );
    expect(normalizeJobSearchCriteria(searchParamsToInput(parameters))).toEqual(
      normalizeJobSearchCriteria(input),
    );
  });

  it("omits defaults while retaining an explicit unknown-salary-only filter", () => {
    expect(searchInputToSearchParams({}).toString()).toBe("");

    const parameters = searchInputToSearchParams({
      salary: { period: "year", unknownPolicy: "only" },
    });
    expect(parameters.toString()).toBe("unknown_salary=only");
    expect(searchParamsToInput(parameters)).toMatchObject({
      salary: { period: "year", unknownPolicy: "only" },
    });
  });

  it("canonicalizes the legacy Remote location shortcut as a work model", () => {
    const input = searchParamsToInput(new URLSearchParams("location=Remote"));

    expect(input).toMatchObject({
      locations: [],
      workModels: ["remote"],
    });
    expect(searchInputToSearchParams(input).toString()).toBe("work=remote");
  });

  it("rejects malformed numeric state rather than silently changing the search", () => {
    expect(() => searchParamsToInput(new URLSearchParams("salary_min=not-a-number"))).toThrow();
    expect(() => searchParamsToInput(new URLSearchParams("limit=999"))).toThrow();
  });
});
