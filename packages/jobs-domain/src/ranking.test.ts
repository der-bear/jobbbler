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

  it("can intentionally return only jobs with undisclosed compensation", () => {
    const criteria = normalizeJobSearchCriteria({
      salary: { unknownPolicy: "only" },
    });

    expect(rankJob(job({ salary: null }), criteria, evaluation).eligible).toBe(true);
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
});
