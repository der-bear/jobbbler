import { describe, expect, it } from "vitest";

import { mergeLocationSuggestions, referenceLocationSuggestions } from "./location-suggestion-data";

describe("referenceLocationSuggestions", () => {
  it.each([
    ["pho", "Phoenix, AZ"],
    ["kyi", "Kyiv, Ukraine"],
    ["sao", "S\u00e3o Paulo, Brazil"],
    ["sing", "Singapore"],
    ["euro", "Europe"],
    ["latin", "Latin America"],
    ["apac", "APAC"],
    ["emea", "EMEA"],
    ["cape", "Cape Town, South Africa"],
    ["united k", "United Kingdom"],
  ])("offers a realistic city, country, or region for %s", (query, expected) => {
    expect(referenceLocationSuggestions(query, 8)).toContain(expected);
  });

  it("returns a bounded list with exact and prefix matches ahead of contains matches", () => {
    expect(referenceLocationSuggestions("asia", 3)).toEqual([
      "Asia",
      "Asia-Pacific",
      "Central Asia",
    ]);
  });
});

describe("mergeLocationSuggestions", () => {
  it("keeps live catalog locations first and deduplicates reference data", () => {
    expect(
      mergeLocationSuggestions(
        ["Phoenix, AZ", "Phoenix, Arizona"],
        ["Phoenix, AZ", "Phoenix, OR"],
        3,
      ),
    ).toEqual(["Phoenix, AZ", "Phoenix, Arizona", "Phoenix, OR"]);
  });
});
