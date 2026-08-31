import { describe, expect, it } from "vitest";

import { locationForSearch } from "./job-format";

describe("locationForSearch", () => {
  it("shows the city that satisfied a city filter instead of the broader hiring region", () => {
    expect(locationForSearch(["Europe", "Amsterdam, Netherlands"], ["Amsterdam"])).toBe(
      "Amsterdam, Netherlands",
    );
  });

  it("keeps the concrete city visible when the person searched by region", () => {
    expect(locationForSearch(["Europe", "Berlin, Germany"], ["Europe"])).toBe("Berlin, Germany");
  });

  it("does not present a broad hiring scope as the role's physical location", () => {
    expect(locationForSearch(["Worldwide"], [])).toBeUndefined();
  });
});
