import { describe, expect, it, vi } from "vitest";

import type { SalaryRange } from "@jobbbler/contracts";

import { salaryLabel } from "@/lib/job-format";

import { fetchLocationSuggestions, locationSuggestions } from "./location-combobox";

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

  it("keeps an unmatched typed location available as valid free text", () => {
    expect(locationSuggestions(["Europe", "Remote"], "Tallinn, Estonia")).toEqual([
      "Tallinn, Estonia",
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

  it("uses local featured choices without requesting the server for an empty query", async () => {
    const request = vi.fn(async () => ({ locations: ["Berlin, Germany"] }));

    await expect(
      fetchLocationSuggestions("", new AbortController().signal, request),
    ).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
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

  it("uses plain language when compensation is missing", () => {
    expect(salaryLabel(null, "EUR")).toBe("Salary not listed");
  });
});
