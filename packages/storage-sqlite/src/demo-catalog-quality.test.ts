import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { jobCategorySchema, jobSchema } from "@jobbbler/contracts";
import { normalizeJobSearchCriteria, rankJob } from "@jobbbler/jobs-domain";

const fixturePath = fileURLToPath(new URL("../../../fixtures/demo-catalog.json", import.meta.url));

interface DemoOrganization {
  readonly id: string;
  readonly name: string;
  readonly website: string | null;
}

interface DemoCatalog {
  readonly organizations: readonly DemoOrganization[];
  readonly jobs: readonly unknown[];
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ");
}

describe("presentation demo catalog", () => {
  it("ships 300 distinct, fictional, application-ready job openings", async () => {
    const catalog = JSON.parse(await readFile(fixturePath, "utf8")) as DemoCatalog;
    const jobs = catalog.jobs.map((job) => jobSchema.parse(job));
    const organizations = new Map(
      catalog.organizations.map((organization) => [organization.id, organization]),
    );
    const normalizedTitles = jobs.map(({ title }) => normalized(title));
    const normalizedSummaries = jobs.map(({ summary }) => normalized(summary));
    const categoryCounts = new Map(jobCategorySchema.options.map((category) => [category, 0]));

    for (const job of jobs) {
      for (const category of job.categories) {
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      }
    }

    expect.soft(jobs).toHaveLength(300);
    expect.soft(catalog.organizations.length).toBeGreaterThanOrEqual(24);
    expect
      .soft(new Set(catalog.organizations.map(({ id }) => id)).size)
      .toBe(catalog.organizations.length);
    expect.soft(new Set(jobs.map(({ id }) => id)).size).toBe(jobs.length);
    expect.soft(new Set(normalizedTitles).size).toBe(jobs.length);
    expect.soft(new Set(normalizedSummaries).size).toBe(jobs.length);
    expect.soft(jobs.every(({ summary }) => summary.length >= 700)).toBe(true);
    expect
      .soft(
        jobs.every(({ summary }) => {
          const paragraphs = summary.split(/\n{2,}/u);
          return paragraphs.length >= 3 && paragraphs.every((paragraph) => paragraph.length >= 80);
        }),
      )
      .toBe(true);
    expect
      .soft(
        jobs.every(({ locations }) =>
          locations.every((location) => location.toLocaleLowerCase("en") !== "global"),
        ),
      )
      .toBe(true);
    expect.soft(jobs.every(({ locations }) => locations[0]?.includes(","))).toBe(true);
    expect
      .soft(
        jobs.every(({ locations }) => {
          const primary = locations[0];
          if (primary === undefined) return false;
          const country = primary.split(", ").at(-1);
          if (country === undefined) return false;
          const region = ["Canada", "United States"].includes(country) ? "North America" : "Europe";
          return locations.join("|") === [primary, country, region].join("|");
        }),
      )
      .toBe(true);
    expect
      .soft(
        jobs.every(({ organizationId, organizationName }) => {
          const organization = organizations.get(organizationId);
          return organization?.name === organizationName && organization.website === null;
        }),
      )
      .toBe(true);
    expect
      .soft(
        jobs.every(
          ({ source }) =>
            source.key === "jobbbler_demo" &&
            source.label === "Jobbbler demo" &&
            source.url === null,
        ),
      )
      .toBe(true);
    expect
      .soft(
        jobs.every(
          ({ salary }) =>
            salary !== null &&
            salary.minimum !== null &&
            salary.maximum !== null &&
            salary.minimum > 0 &&
            salary.maximum > salary.minimum,
        ),
      )
      .toBe(true);
    expect.soft(jobs.every(({ applyMode }) => applyMode === "internal")).toBe(true);
    expect.soft(jobs.every(({ status }) => status === "open")).toBe(true);
    expect.soft([...categoryCounts.values()].every((count) => count >= 12)).toBe(true);
    expect
      .soft(
        jobs.every(
          ({ publishedAt, updatedAt }) => Date.parse(updatedAt) >= Date.parse(publishedAt),
        ),
      )
      .toBe(true);
  });

  it("supports a principal product-design search without relaxing role, seniority, work, or pay", async () => {
    const catalog = JSON.parse(await readFile(fixturePath, "utf8")) as DemoCatalog;
    const jobs = catalog.jobs.map((job) => jobSchema.parse(job));
    const criteria = normalizeJobSearchCriteria({
      query: "Principal Product Designer",
      categories: ["design_research"],
      workModels: ["remote"],
      seniorities: ["principal"],
      salary: {
        minimum: 120_000,
        currency: "USD",
        period: "year",
        unknownPolicy: "exclude",
      },
      sort: "salary_desc",
      limit: 3,
    });

    const matches = jobs
      .map((job) => ({ job, rank: rankJob(job, criteria, { now: new Date("2026-09-03") }) }))
      .filter(({ rank }) => rank.eligible);

    expect(matches).toHaveLength(2);
    expect(matches.map(({ job }) => job.title)).toEqual([
      "Principal Product Designer, Grower Platform",
      "Principal Product Designer, Clinical Workflows",
    ]);
    expect(matches.every(({ rank }) => rank.dimensions.salary.status === "match")).toBe(true);
  });
});
