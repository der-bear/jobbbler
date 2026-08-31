import { describe, expect, it, vi } from "vitest";

import type { SalaryRange } from "@jobbbler/contracts";

import { salaryCardPresentation, salaryLabel } from "@/lib/job-format";

import {
  fetchLocationSuggestions,
  locationEnterChoice,
  locationSuggestionItems,
  locationSuggestions,
} from "./location-combobox";

describe("locationSuggestions", () => {
  it("returns a short, case-insensitive set of relevant locations without duplicates", () => {
    expect(
      locationSuggestions(["Europe", "Kyiv, Ukraine", "Remote", "Europe", "Berlin, Germany"], "e"),
    ).toEqual(["Europe", "Kyiv, Ukraine", "Remote", "Berlin, Germany"]);
  });

  it("keeps useful starting options when the field is empty", () => {
    expect(locationSuggestions(["Kyiv, Ukraine", "Berlin, Germany"], "")).toEqual([
      "Remote",
      "Global",
      "Europe",
      "Kyiv, Ukraine",
      "Berlin, Germany",
    ]);
  });

  it("presents unmatched text as an explicit free-text action", () => {
    expect(locationSuggestions(["Europe", "Remote"], "Tallinn, Estonia")).toEqual([]);
    expect(locationSuggestionItems(["Europe", "Remote"], "Tallinn, Estonia")).toEqual([
      {
        kind: "free-text",
        label: "Search for \u201cTallinn, Estonia\u201d",
        value: "Tallinn, Estonia",
      },
    ]);
  });

  it("keeps an explicit free-text action after realistic matching suggestions", () => {
    expect(locationSuggestionItems(["Phoenix, AZ", "Phoenixville, PA", "Europe"], "Pho")).toEqual([
      { kind: "suggestion", label: "Phoenix, AZ", value: "Phoenix, AZ" },
      { kind: "suggestion", label: "Phoenixville, PA", value: "Phoenixville, PA" },
      { kind: "free-text", label: "Search for \u201cPho\u201d", value: "Pho" },
    ]);
  });

  it("does not duplicate free text when it exactly matches a known choice", () => {
    expect(locationSuggestionItems(["Phoenix, AZ"], "Phoenix, AZ")).toEqual([
      { kind: "suggestion", label: "Phoenix, AZ", value: "Phoenix, AZ" },
    ]);
  });

  it("offers a friendly canonical country for a common exact alias", () => {
    expect(locationSuggestions([], "uk")).toEqual(["United Kingdom"]);
    expect(locationSuggestions([], "USA")).toEqual(["United States"]);
  });

  it("puts the exact canonical location first without collapsing distinct stored values", () => {
    expect(
      locationSuggestions(
        ["Remote Europe", "Remote - Europe", "Remote - Global", "Remote Worldwide"],
        "Remote",
      ),
    ).toEqual([
      "Remote",
      "Remote Europe",
      "Remote - Europe",
      "Remote - Global",
      "Remote Worldwide",
    ]);
  });

  it("requests a small encoded suggestion page instead of loading the whole catalog", async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async () => ({ locations: ["Kyiv, Ukraine"] }));

    await expect(fetchLocationSuggestions("Kyiv & remote", signal, request)).resolves.toEqual([
      "Kyiv, Ukraine",
    ]);
    expect(request).toHaveBeenCalledWith(
      "/api/v1/jobs/locations?q=Kyiv+%26+remote&limit=8",
      expect.anything(),
      { signal },
    );
  });

  it("loads catalog suggestions with a canonical country query for a common alias", async () => {
    const signal = new AbortController().signal;
    const request = vi.fn(async () => ({ locations: ["United Kingdom"] }));

    await expect(fetchLocationSuggestions("UK", signal, request)).resolves.toEqual([
      "United Kingdom",
    ]);
    expect(request).toHaveBeenCalledWith(
      "/api/v1/jobs/locations?q=United+Kingdom&limit=8",
      expect.anything(),
      { signal },
    );
  });

  it("uses local featured choices without requesting the server for an empty query", async () => {
    const request = vi.fn(async () => ({ locations: ["Berlin, Germany"] }));

    await expect(
      fetchLocationSuggestions("", new AbortController().signal, request),
    ).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("chooses the best known place on Enter when no suggestion was highlighted", () => {
    const items = locationSuggestionItems(["Phoenix, AZ"], "Phoenix");

    expect(locationEnterChoice(items, -1, "Phoenix")).toEqual({
      kind: "suggestion",
      label: "Phoenix, AZ",
      value: "Phoenix, AZ",
    });
  });

  it("commits free text on Enter when no known location matches", () => {
    const items = locationSuggestionItems([], "Tallinn, Estonia");

    expect(locationEnterChoice(items, -1, "Tallinn, Estonia")).toEqual({
      kind: "free-text",
      label: "Search for \u201cTallinn, Estonia\u201d",
      value: "Tallinn, Estonia",
    });
  });

  it("keeps an explicitly highlighted location as the Enter choice", () => {
    const items = locationSuggestionItems(["Phoenix, AZ"], "Phoenix");

    expect(locationEnterChoice(items, 0, "Phoenix")).toEqual({
      kind: "suggestion",
      label: "Phoenix, AZ",
      value: "Phoenix, AZ",
    });
  });

  it("does not invent an Enter choice for an empty location", () => {
    expect(locationEnterChoice(locationSuggestionItems([], ""), -1, "")).toBeNull();
  });
});

describe("salaryLabel", () => {
  const salary: SalaryRange = {
    minimum: 120_000,
    maximum: 150_000,
    currency: "USD",
    period: "year",
  };

  it("converts a disclosed range into the selected display currency", () => {
    const label = salaryLabel(salary, "EUR");

    expect(label).toMatch(/^≈/);
    expect(label).toContain("€");
    expect(label).not.toContain("$");
    expect(label).toContain("/ yr");
  });

  it("does not mark an unchanged currency as approximate", () => {
    expect(salaryLabel(salary, "USD")).toMatch(/^\$/);
  });

  it("formats both ends of an annual range with one compact scale", () => {
    expect(
      salaryLabel(
        {
          minimum: 95_000,
          maximum: 125_000,
          currency: "USD",
          period: "year",
        },
        "USD",
      ),
    ).toBe("$95k–$125k / yr");
  });

  it("shows hourly compensation as a comparable annual estimate on result cards", () => {
    expect(
      salaryLabel(
        {
          minimum: 55,
          maximum: 75,
          currency: "EUR",
          period: "hour",
        },
        "EUR",
      ),
    ).toBe("≈€114k–€156k / yr");

    expect(
      salaryLabel(
        {
          minimum: 70,
          maximum: 90,
          currency: "USD",
          period: "hour",
        },
        "EUR",
      ),
    ).toBe("≈€125k–€160k / yr");
  });

  it("keeps the source currency and period when no card display currency is requested", () => {
    expect(salaryLabel({ minimum: 70, maximum: 90, currency: "USD", period: "hour" })).toBe(
      "$70–$90 / hr",
    );
  });

  it("preserves the original salary facts in an accessible card explanation", () => {
    expect(
      salaryCardPresentation({ minimum: 70, maximum: 90, currency: "USD", period: "hour" }, "EUR"),
    ).toEqual({
      label: "≈€125k–€160k / yr",
      explanation:
        "Estimated annual compensation in EUR. Originally listed as $70–$90 per hour; converted using Jobbbler's fixed demo rates and annualized at 2,080 hours per year.",
    });
  });

  it("falls back to unsupported source compensation without implying conversion", () => {
    expect(
      salaryCardPresentation(
        { minimum: 100_000, maximum: 120_000, currency: "CHF", period: "year" },
        "EUR",
      ),
    ).toEqual({
      label: "CHF\u00a0100k–CHF\u00a0120k / yr",
      explanation:
        "Shown as listed because CHF is not available in Jobbbler's fixed demo conversion table.",
    });
  });

  it("does not invent a conversion problem when a salary has no disclosed amount", () => {
    expect(
      salaryCardPresentation(
        { minimum: null, maximum: null, currency: "EUR", period: "year" },
        "EUR",
      ),
    ).toEqual({ label: "Salary not listed", explanation: null });
  });

  it("uses plain language when compensation is missing", () => {
    expect(salaryLabel(null, "EUR")).toBe("Salary not listed");
  });
});
