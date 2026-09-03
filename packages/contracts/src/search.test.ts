import { describe, expect, it } from "vitest";

import {
  jobSearchInputSchema,
  locationSuggestionsResultSchema,
  searchSortSchema,
} from "./search.js";

describe("jobSearchInputSchema", () => {
  it("normalizes bounded human search input", () => {
    const parsed = jobSearchInputSchema.parse({
      query: "  Senior product engineer  ",
      categories: ["software_engineering", "product"],
      employmentTypes: ["full_time", "contract"],
      locations: [" Europe ", "Kyiv"],
      remoteOrLocations: true,
      salary: {
        minimum: 100_000,
        currency: "eur",
        period: "year",
        unknownPolicy: "include",
      },
      limit: 24,
    });

    expect(parsed.query).toBe("Senior product engineer");
    expect(parsed.locations).toEqual(["Europe", "Kyiv"]);
    expect(parsed.employmentTypes).toEqual(["full_time", "contract"]);
    expect(parsed.remoteOrLocations).toBe(true);
    expect(parsed.salary?.currency).toBe("EUR");
    expect(parsed.limit).toBe(24);
  });

  it("rejects categories outside the IT and adjacent-technology taxonomy", () => {
    expect(() => jobSearchInputSchema.parse({ categories: ["hospitality"] })).toThrow();
  });

  it("rejects contradictory or unbounded criteria", () => {
    expect(() =>
      jobSearchInputSchema.parse({
        salary: { minimum: 140_000, maximum: 100_000, currency: "EUR" },
      }),
    ).toThrow();

    expect(() => jobSearchInputSchema.parse({ limit: 51 })).toThrow();
    expect(() => jobSearchInputSchema.parse({ query: "x".repeat(501) })).toThrow();
  });

  it("accepts every user-facing deterministic sort order", () => {
    expect(searchSortSchema.options).toEqual([
      "relevance",
      "newest",
      "updated_desc",
      "salary_desc",
      "salary_asc",
    ]);
  });
});

describe("locationSuggestionsResultSchema", () => {
  it("keeps a bounded ordered list of human-readable locations", () => {
    expect(
      locationSuggestionsResultSchema.parse({ locations: ["Berlin, Germany", "Europe"] }),
    ).toEqual({ locations: ["Berlin, Germany", "Europe"] });
    expect(() =>
      locationSuggestionsResultSchema.parse({ locations: Array(21).fill("Europe") }),
    ).toThrow();
  });
});
