import { describe, expect, it } from "vitest";

import { normalizeJobSearchCriteria } from "./search-criteria.js";

describe("normalizeJobSearchCriteria", () => {
  it("deduplicates canonical text and preserves explicit unknown policy", () => {
    const criteria = normalizeJobSearchCriteria({
      query: "  Senior   TypeScript Engineer  ",
      categories: ["software_engineering", "product", "software_engineering"],
      workModels: ["remote", "remote"],
      locations: [" Europe ", "europe", " Kyiv "],
      skills: [" TypeScript ", "typescript", "React"],
      excludeKeywords: [" Agency ", "agency"],
      salary: {
        minimum: 100_000,
        currency: "eur",
        period: "year",
        unknownPolicy: "include",
      },
    });

    expect(criteria.query).toBe("Senior TypeScript Engineer");
    expect(criteria.categories).toEqual(["product", "software_engineering"]);
    expect(criteria.workModels).toEqual(["remote"]);
    expect(criteria.locations).toEqual(["Europe", "Kyiv"]);
    expect(criteria.skills).toEqual(["React", "TypeScript"]);
    expect(criteria.excludeKeywords).toEqual(["Agency"]);
    expect(criteria.salary).toMatchObject({
      minimum: 100_000,
      currency: "EUR",
      period: "year",
      unknownPolicy: "include",
    });
  });

  it("does not invent filters from prose", () => {
    const criteria = normalizeJobSearchCriteria({
      query: "remote-looking role with strong compensation",
    });

    expect(criteria.workModels).toEqual([]);
    expect(criteria.salary).toBeNull();
    expect(criteria.unresolvedAssumptions).toEqual([]);
  });
});
