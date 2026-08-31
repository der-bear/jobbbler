import { describe, expect, it } from "vitest";

import { locationForSearch, relativeFreshness } from "./job-format";

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

describe("relativeFreshness", () => {
  it("keeps the compact visible label free of a repeated Updated prefix", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");

    expect(relativeFreshness("2026-09-01T09:00:00.000Z", now)).toBe("3h ago");
    expect(relativeFreshness("2026-08-29T12:00:00.000Z", now)).toBe("3d ago");
  });
});
