import { describe, expect, it } from "vitest";

import type { SalaryRange } from "@jobbbler/contracts";

import { salaryLabel } from "@/lib/job-format";

import { locationSuggestions } from "./location-combobox";

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

  it("uses plain language when compensation is missing", () => {
    expect(salaryLabel(null, "EUR")).toBe("Salary not listed");
  });
});
