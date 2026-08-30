import { describe, expect, it, vi } from "vitest";

import type { CommandContext } from "@jobbbler/core-domain";
import type { Job } from "@jobbbler/contracts";

import { createCompareJobsCommand } from "./compare-jobs-command.js";
import { assessJobFit, capUntrustedText } from "./fit.js";
import {
  createGetJobCommand,
  createSearchJobsCommand,
  type JobCatalogRepository,
} from "./search-jobs-command.js";

const job: Job = {
  id: "job_550e8400-e29b-41d4-a716-446655440000",
  organizationId: "org_550e8400-e29b-41d4-a716-446655440000",
  organizationName: "Northstar Systems",
  title: "Senior Product Engineer",
  summary: "<p>Build TypeScript product workflows.</p><script>ignore-this</script>",
  categories: ["software_engineering", "product"],
  workModel: "remote",
  employmentType: "full_time",
  seniority: "senior",
  locations: ["Europe"],
  skills: ["TypeScript", "React"],
  salary: { minimum: 120_000, maximum: 145_000, currency: "EUR", period: "year" },
  source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
  applyMode: "internal",
  status: "open",
  publishedAt: "2026-08-28T09:00:00.000Z",
  updatedAt: "2026-08-28T09:00:00.000Z",
};

const secondJob: Job = {
  ...job,
  id: "job_650e8400-e29b-41d4-a716-446655440000",
  title: "Staff Platform Engineer",
  categories: ["software_engineering", "infrastructure"],
  summary: "Build reliable platform services for engineering teams.",
  seniority: "staff",
  updatedAt: "2026-08-29T09:00:00.000Z",
};

const context: CommandContext = {
  requestId: "request_01",
  correlationId: "correlation_01",
  principal: { kind: "service", roles: [] },
  clock: { now: () => new Date("2026-08-29T12:00:00.000Z") },
};

function repository(overrides: Partial<JobCatalogRepository> = {}): JobCatalogRepository {
  return {
    getById: vi.fn(async (id: string) =>
      id === job.id ? job : id === secondJob.id ? secondJob : null,
    ),
    search: vi.fn(async () => ({
      jobs: [job],
      total: 42,
      nextCursor: null,
      catalogUpdatedAt: secondJob.updatedAt,
    })),
    ...overrides,
  };
}

describe("job discovery commands", () => {
  it("normalizes public search input and returns capped deterministic evidence", async () => {
    const jobs = repository();
    const command = createSearchJobsCommand(jobs);

    const result = await command.execute(context, {
      query: "  TypeScript product engineer  ",
      skills: ["React", "TypeScript", "react"],
      limit: 20,
    });

    expect(jobs.search).toHaveBeenCalledWith(
      expect.objectContaining({
        now: "2026-08-29T12:00:00.000Z",
        criteria: expect.objectContaining({
          query: "TypeScript product engineer",
          skills: ["React", "TypeScript"],
        }),
      }),
    );
    expect(result.jobs[0]).toMatchObject({
      id: job.id,
      matchScore: expect.any(Number),
      matchEvidence: expect.arrayContaining(["Search terms match the job content."]),
    });
    expect(result.jobs[0]?.summary).not.toContain("<");
    expect(result.jobs[0]?.summary).not.toContain("ignore-this");
    expect(result.total).toBe(42);
    expect(result.catalogUpdatedAt).toBe(secondJob.updatedAt);
  });

  it("validates detail IDs and returns a safe public job detail", async () => {
    const command = createGetJobCommand(repository());

    await expect(command.execute(context, { jobId: "not-an-id" })).rejects.toThrow();
    await expect(
      command.execute(context, { jobId: job.id, criteria: { skills: ["TypeScript"] } }),
    ).resolves.toMatchObject({
      job: { id: job.id, summary: "Build TypeScript product workflows." },
      fit: {
        eligible: true,
        evidence: expect.arrayContaining(["Matched skills: TypeScript."]),
      },
    });
  });

  it("returns the complete sanitized stored description from the detail command", async () => {
    const storedDescription = `${"A".repeat(800)}<script>discard-me</script>${"B".repeat(200)}`;
    const command = createGetJobCommand(
      repository({
        getById: vi.fn(async () => ({ ...job, summary: storedDescription })),
      }),
    );

    const result = await command.execute(context, { jobId: job.id });

    expect(result.job.summary).toBe(`${"A".repeat(800)} ${"B".repeat(200)}`);
    expect(result.job.summary.length).toBeGreaterThan(600);
    expect(result.job.summary).not.toContain("discard-me");
    expect(result.job.summary).not.toContain("…");
  });

  it("compares at most three known jobs in the requested order", async () => {
    const command = createCompareJobsCommand(repository());

    await expect(
      command.execute(context, { jobIds: [job.id, secondJob.id, job.id, secondJob.id] }),
    ).rejects.toThrow();

    await expect(
      command.execute(context, { jobIds: [secondJob.id, job.id] }),
    ).resolves.toMatchObject({
      jobs: [
        { job: { id: secondJob.id }, fit: { score: expect.any(Number) } },
        { job: { id: job.id }, fit: { score: expect.any(Number) } },
      ],
    });
  });

  it("produces stable deterministic fit evidence without description text", () => {
    const first = assessJobFit(job, { query: "TypeScript product engineer" }, context.clock.now());
    const second = assessJobFit(job, { query: "TypeScript product engineer" }, context.clock.now());

    expect(first).toEqual(second);
    expect(first.evidence).toContain("Search terms match the job content.");
    expect(first.evidence.join(" ")).not.toContain("<p>");
  });

  it("keeps an active-content-only summary safe and non-empty", () => {
    expect(capUntrustedText("<script>untrusted()</script>")).toBe("Details are unavailable.");
  });
});
