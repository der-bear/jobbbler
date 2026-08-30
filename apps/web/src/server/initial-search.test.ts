import { describe, expect, it } from "vitest";

import type { Job } from "@jobbbler/contracts";
import { createSearchJobsCommand, type JobCatalogRepository } from "@jobbbler/jobs-domain";

import { loadInitialSearch } from "./initial-search";

const job: Job = {
  id: "job_550e8400-e29b-41d4-a716-446655440000",
  organizationId: "org_550e8400-e29b-41d4-a716-446655440000",
  organizationName: "Northstar Systems",
  title: "Senior Platform Engineer",
  summary: "Build TypeScript platform workflows.",
  categories: ["software_engineering"],
  workModel: "remote",
  employmentType: "full_time",
  seniority: "senior",
  locations: ["Europe"],
  skills: ["TypeScript"],
  salary: { minimum: 120_000, maximum: 145_000, currency: "EUR", period: "year" },
  source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
  applyMode: "internal",
  status: "open",
  publishedAt: "2026-08-28T09:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
};

function searchCommand() {
  let searchCalls = 0;
  const repository: JobCatalogRepository = {
    getById: async () => null,
    search: async () => {
      searchCalls += 1;
      return {
        jobs: [job],
        total: 1,
        nextCursor: null,
        catalogUpdatedAt: job.updatedAt,
      };
    },
  };
  return {
    command: createSearchJobsCommand(repository),
    searchCalls: () => searchCalls,
  };
}

describe("loadInitialSearch", () => {
  it("validates page search parameters and returns the first public search result", async () => {
    const { command, searchCalls } = searchCommand();

    const initial = await loadInitialSearch(
      {
        q: "platform",
        work: ["remote"],
        limit: "10",
      },
      command,
    );

    expect(initial.error).toBeNull();
    expect(initial.input).toMatchObject({
      query: "platform",
      workModels: ["remote"],
      sort: "relevance",
      limit: 10,
    });
    expect(initial.result).toMatchObject({
      total: 1,
      criteria: { query: "platform", workModels: ["remote"], limit: 10 },
      jobs: [{ id: job.id }],
    });
    expect(searchCalls()).toBe(1);
  });

  it("returns a recoverable initial error without searching invalid parameters", async () => {
    const { command, searchCalls } = searchCommand();

    const initial = await loadInitialSearch({ limit: "999" }, command);

    expect(initial).toEqual({
      input: { sort: "newest", limit: 20 },
      result: null,
      error: "Some search filters are invalid. Adjust them and search again.",
    });
    expect(searchCalls()).toBe(0);
  });
});
