import { describe, expect, it } from "vitest";

import type { Job } from "./job.js";
import { rankJob } from "./ranking.js";
import { normalizeJobSearchCriteria } from "./search-criteria.js";

const baseJob: Job = {
  id: "job_550e8400-e29b-41d4-a716-446655440000",
  organizationId: "org_550e8400-e29b-41d4-a716-446655440000",
  organizationName: "Northstar Systems",
  title: "Senior Product Engineer",
  summary: "Build a TypeScript workflow product for engineering teams.",
  categories: ["software_engineering", "product"],
  workModel: "remote",
  employmentType: "full_time",
  seniority: "senior",
  locations: ["Europe"],
  skills: ["TypeScript", "React", "PostgreSQL"],
  salary: {
    minimum: 120_000,
    maximum: 145_000,
    currency: "EUR",
    period: "year",
  },
  source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
  applyMode: "internal",
  status: "open",
  publishedAt: "2026-08-28T09:00:00.000Z",
  updatedAt: "2026-08-28T09:00:00.000Z",
};

const evaluation = { now: new Date("2026-08-29T12:00:00.000Z") };

function job(overrides: Partial<Job> = {}): Job {
  return { ...baseJob, ...overrides };
}

describe("rankJob", () => {
  it("keeps unknown salary distinct from below threshold", () => {
    const criteria = normalizeJobSearchCriteria({
      salary: {
        minimum: 100_000,
        currency: "EUR",
        period: "year",
        unknownPolicy: "include",
      },
    });

    const unknown = rankJob(job({ salary: null }), criteria, evaluation);
    const below = rankJob(
      job({
        salary: {
          minimum: 80_000,
          maximum: 90_000,
          currency: "EUR",
          period: "year",
        },
      }),
      criteria,
      evaluation,
    );

    expect(unknown.dimensions.salary.status).toBe("unknown");
    expect(unknown.eligible).toBe(true);
    expect(below.dimensions.salary.status).toBe("below");
    expect(below.eligible).toBe(false);
  });

  it("compares salaries across currencies with pinned approximate rates", () => {
    const criteria = normalizeJobSearchCriteria({
      salary: {
        minimum: 100_000,
        currency: "EUR",
        period: "year",
        unknownPolicy: "include",
      },
    });

    const usdMatch = rankJob(
      job({
        salary: { minimum: 130_000, maximum: 150_000, currency: "USD", period: "year" },
      }),
      criteria,
      evaluation,
    );
    const usdBelow = rankJob(
      job({
        salary: { minimum: 60_000, maximum: 80_000, currency: "USD", period: "year" },
      }),
      criteria,
      evaluation,
    );
    const unknownCurrency = rankJob(
      job({
        salary: { minimum: 130_000, maximum: 150_000, currency: "CHF", period: "year" },
      }),
      criteria,
      evaluation,
    );
    const hourlyUsd = rankJob(
      job({
        salary: { minimum: 130_000, maximum: 150_000, currency: "USD", period: "hour" },
      }),
      criteria,
      evaluation,
    );

    expect(usdMatch.dimensions.salary.status).toBe("match");
    expect(usdMatch.dimensions.salary.matched[0]).toContain("converted from USD");
    expect(usdBelow.dimensions.salary.status).toBe("below");
    expect(usdBelow.eligible).toBe(false);
    expect(unknownCurrency.dimensions.salary.status).toBe("unknown");
    expect(hourlyUsd.dimensions.salary.status).toBe("unknown");
  });

  it("can intentionally return only jobs with undisclosed compensation", () => {
    const criteria = normalizeJobSearchCriteria({
      salary: { unknownPolicy: "only" },
    });

    const undisclosed = rankJob(job({ salary: null }), criteria, evaluation);

    expect(undisclosed.eligible).toBe(true);
    expect(undisclosed.score).toBe(100);
    expect(undisclosed.dimensions.salary).toEqual({
      status: "match",
      score: 1,
      matched: ["undisclosed salary"],
      missing: [],
    });
    expect(undisclosed.caveats).not.toContain("Comparable compensation is unavailable.");
    expect(rankJob(baseJob, criteria, evaluation).eligible).toBe(false);
  });

  it("does not treat an upper-only range as proof of a salary floor", () => {
    const criteria = normalizeJobSearchCriteria({
      salary: {
        minimum: 100_000,
        currency: "EUR",
        period: "year",
        unknownPolicy: "include",
      },
    });
    const upperOnly = job({
      salary: {
        minimum: null,
        maximum: 150_000,
        currency: "EUR",
        period: "year",
      },
    });

    const ranked = rankJob(upperOnly, criteria, evaluation);

    expect(ranked.dimensions.salary.status).toBe("unknown");
    expect(ranked.eligible).toBe(true);

    const strictCriteria = normalizeJobSearchCriteria({
      salary: {
        minimum: 100_000,
        currency: "EUR",
        period: "year",
        unknownPolicy: "exclude",
      },
    });
    expect(rankJob(upperOnly, strictCriteria, evaluation).eligible).toBe(false);
  });

  it("treats exclusions as a hard gate with evidence", () => {
    const criteria = normalizeJobSearchCriteria({
      query: "product engineer",
      excludeKeywords: ["agency"],
    });

    const ranked = rankJob(
      job({ summary: "Join a product agency serving technology clients." }),
      criteria,
      evaluation,
    );

    expect(ranked.eligible).toBe(false);
    expect(ranked.exclusions).toContain("agency");
    expect(ranked.evidence.join(" ")).toMatch(/excluded/i);
  });

  it("enforces explicit seniority and freshness filters", () => {
    const seniorityCriteria = normalizeJobSearchCriteria({
      seniorities: ["staff"],
    });
    const freshnessCriteria = normalizeJobSearchCriteria({
      postedWithinDays: 7,
    });
    expect(rankJob(baseJob, seniorityCriteria, evaluation).eligible).toBe(false);
    expect(
      rankJob(job({ publishedAt: "2026-08-01T09:00:00.000Z" }), freshnessCriteria, evaluation)
        .eligible,
    ).toBe(false);
    expect(rankJob(baseJob, freshnessCriteria, evaluation).eligible).toBe(true);
  });

  it("treats employment type as an explicit eligibility filter", () => {
    const contractOnly = normalizeJobSearchCriteria({ employmentTypes: ["contract"] });
    const fullTimeOrContract = normalizeJobSearchCriteria({
      employmentTypes: ["contract", "full_time"],
    });

    const rejected = rankJob(baseJob, contractOnly, evaluation);
    const accepted = rankJob(baseJob, fullTimeOrContract, evaluation);

    expect(rejected.eligible).toBe(false);
    expect(accepted.eligible).toBe(true);
    expect(accepted.evidence).toContain("Employment type is full_time.");
  });

  it("matches a canonical country when the search used its common alias", () => {
    const criteria = normalizeJobSearchCriteria({ locations: ["UK"] });

    const ranked = rankJob(
      job({ locations: ["London, United Kingdom", "United Kingdom", "Europe"] }),
      criteria,
      evaluation,
    );

    expect(ranked.eligible).toBe(true);
    expect(ranked.dimensions.locations).toMatchObject({
      status: "match",
      matched: ["United Kingdom"],
      missing: [],
    });
  });

  it("does not broaden a city search to every role in the same country", () => {
    const criteria = normalizeJobSearchCriteria({ locations: ["Phoenix, United States"] });
    const phoenix = rankJob(
      job({ locations: ["Phoenix, United States", "United States", "North America"] }),
      criteria,
      evaluation,
    );
    const denver = rankJob(
      job({ locations: ["Denver, United States", "United States", "North America"] }),
      criteria,
      evaluation,
    );

    expect(phoenix.eligible).toBe(true);
    expect(denver.eligible).toBe(false);
  });

  it("matches roles in the requested city or remote roles anywhere", () => {
    const criteria = normalizeJobSearchCriteria({ locations: ["Berlin", "Remote"] });
    const remoteElsewhere = rankJob(
      job({ workModel: "remote", locations: ["Lisbon, Portugal", "Portugal", "Europe"] }),
      criteria,
      evaluation,
    );
    const berlinOnsite = rankJob(
      job({ workModel: "onsite", locations: ["Berlin, Germany", "Germany", "Europe"] }),
      criteria,
      evaluation,
    );
    const parisOnsite = rankJob(
      job({ workModel: "onsite", locations: ["Paris, France", "France", "Europe"] }),
      criteria,
      evaluation,
    );

    expect(remoteElsewhere.eligible).toBe(true);
    expect(berlinOnsite.eligible).toBe(true);
    expect(parisOnsite.eligible).toBe(false);
  });

  it("returns deterministic dimension evidence for an eligible match", () => {
    const criteria = normalizeJobSearchCriteria({
      query: "TypeScript product engineer",
      categories: ["software_engineering"],
      workModels: ["remote"],
      seniorities: ["senior"],
      locations: ["Europe"],
      skills: ["TypeScript", "React"],
    });

    const ranked = rankJob(baseJob, criteria, evaluation);

    expect(ranked.eligible).toBe(true);
    expect(ranked.score).toBeGreaterThanOrEqual(80);
    expect(ranked.dimensions.text.status).toBe("match");
    expect(ranked.dimensions.skills.matched).toEqual(["React", "TypeScript"]);
    expect(ranked.evidence.length).toBeGreaterThan(2);
  });

  it("ranks title matches above the same terms found only in body copy", () => {
    const criteria = normalizeJobSearchCriteria({ query: "security" });
    const titleMatch = rankJob(
      job({
        title: "Security Engineer",
        summary: "Build dependable systems for technology teams.",
      }),
      criteria,
      evaluation,
    );
    const bodyMatch = rankJob(
      job({
        title: "Chief Technology Officer",
        summary: "Lead engineering, operations, and security across the company.",
      }),
      criteria,
      evaluation,
    );

    expect(titleMatch.eligible).toBe(true);
    expect(bodyMatch.eligible).toBe(true);
    expect(titleMatch.dimensions.text.score).toBeGreaterThan(bodyMatch.dimensions.text.score);
    expect(titleMatch.score).toBeGreaterThan(bodyMatch.score);
  });
});
