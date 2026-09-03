import { describe, expect, it } from "vitest";

import type { JobSearchCriteria } from "@jobbbler/contracts";

import { decodeJobSearchCursor, encodeJobSearchCursor } from "./search-pagination";

const criteria: JobSearchCriteria = {
  query: "Principal Product Designer",
  categories: ["design_research"],
  workModels: ["flexible", "hybrid", "onsite", "remote"],
  employmentTypes: ["full_time"],
  seniorities: ["principal"],
  locations: ["Berlin"],
  remoteOrLocations: true,
  skills: [],
  excludeKeywords: [],
  salary: null,
  postedWithinDays: null,
  sort: "relevance",
  cursor: null,
  limit: 3,
  unresolvedAssumptions: [],
};

describe("job-search pagination", () => {
  it("binds a cursor to the city-or-remote interpretation", () => {
    const key = {
      primary: 95,
      publishedAtMs: Date.parse("2026-09-01T09:00:00.000Z"),
      id: "job_00000199-0000-7000-8000-000000000199",
    };
    const cursor = encodeJobSearchCursor(key, criteria);

    expect(decodeJobSearchCursor(cursor, criteria)).toEqual(key);
    expect(() => decodeJobSearchCursor(cursor, { ...criteria, remoteOrLocations: false })).toThrow(
      "Search cursor is invalid or does not match the current search.",
    );
  });
});
