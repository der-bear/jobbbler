import { describe, expect, it } from "vitest";

import type { JobFit } from "@jobbbler/contracts";

import {
  compareApiUrl,
  comparePageHref,
  comparisonLocation,
  comparisonRowVisibility,
  comparisonSearchHref,
  comparisonSourceDestination,
  removeComparedJob,
  resolveCompareSelection,
} from "./compare-state";

const rank: JobFit["dimensions"]["text"] = {
  status: "not_requested",
  score: 0,
  matched: [],
  missing: [],
};
const neutralFit: JobFit = {
  eligible: true,
  score: 0,
  evidence: [],
  caveats: [],
  exclusions: [],
  dimensions: {
    text: rank,
    categories: rank,
    workModel: rank,
    seniority: rank,
    locations: rank,
    skills: rank,
    salary: rank,
    freshness: rank,
  },
};

describe("shareable comparison state", () => {
  it("keeps one to three distinct job IDs in their URL order", () => {
    expect(resolveCompareSelection(["job_alpha", "job_beta", "job_gamma"])).toEqual({
      kind: "ready",
      jobIds: ["job_alpha", "job_beta", "job_gamma"],
    });
  });

  it("does not issue an ambiguous comparison for missing, duplicate, or oversized selections", () => {
    expect(resolveCompareSelection([])).toEqual({ kind: "missing" });
    expect(resolveCompareSelection(["job_alpha", " "])).toEqual({ kind: "invalid" });
    expect(resolveCompareSelection(["job_alpha", "job_alpha"])).toEqual({ kind: "invalid" });
    expect(resolveCompareSelection(["job_a", "job_b", "job_c", "job_d"])).toEqual({
      kind: "invalid",
    });
  });

  it("uses repeated encoded id parameters for the comparison API", () => {
    expect(compareApiUrl(["job_alpha", "job/a b"])).toBe(
      "/api/v1/jobs/compare?id=job_alpha&id=job%2Fa+b",
    );
  });

  it("keeps the originating search criteria in comparison ranking requests", () => {
    expect(compareApiUrl(["job_alpha"], "work=remote&salary_min=100000&currency=EUR")).toBe(
      "/api/v1/jobs/compare?work=remote&salary_min=100000&currency=EUR&id=job_alpha",
    );
  });

  it("builds stable human compare, add-more, and remove URLs without changing agent API state", () => {
    expect(comparePageHref(["job_alpha", "job/a b"], "work=remote&sort=newest")).toBe(
      "/compare?work=remote&sort=newest&id=job_alpha&id=job%2Fa+b",
    );
    expect(comparisonSearchHref(["job_alpha", "job/a b"], "work=remote&sort=newest")).toBe(
      "/jobs?work=remote&sort=newest&compare=job_alpha&compare=job%2Fa+b",
    );
    expect(removeComparedJob(["job_alpha", "job_beta", "job_gamma"], "job_beta")).toEqual([
      "job_alpha",
      "job_gamma",
    ]);
  });

  it("hides comparison rows that repeat no decision-useful information", () => {
    expect(comparisonRowVisibility([neutralFit, neutralFit])).toEqual({
      eligibility: false,
      fit: false,
      tradeOffs: false,
      unknowns: false,
    });

    expect(
      comparisonRowVisibility([
        neutralFit,
        {
          ...neutralFit,
          eligible: false,
          evidence: ["Remote work matches."],
          caveats: ["Salary is not stated."],
          dimensions: {
            ...neutralFit.dimensions,
            salary: { ...rank, status: "unknown" },
          },
        },
      ]),
    ).toEqual({ eligibility: true, fit: true, tradeOffs: true, unknowns: true });
  });

  it("shows one concrete city without repeating its country and region", () => {
    expect(comparisonLocation(["Berlin, Germany", "Germany", "Europe"])).toBe("Berlin, Germany");
    expect(comparisonLocation(["Europe"])).toBe("Europe");
    expect(comparisonLocation([])).toBe("Location not stated");
  });

  it("describes managed demo applications without implying a missing source", () => {
    expect(comparisonSourceDestination("internal", null)).toBe("Apply on Jobbbler");
    expect(comparisonSourceDestination("external", null)).toBe("Application link unavailable");
    expect(comparisonSourceDestination("external", "https://example.com/jobs/1")).toBeNull();
  });
});
