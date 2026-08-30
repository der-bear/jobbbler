import { describe, expect, it, vi } from "vitest";

import type { Job } from "@jobbbler/contracts";
import { createSearchJobsCommand, type JobCatalogRepository } from "@jobbbler/jobs-domain";

import type { DiscoveryRouteDependencies } from "./commands";
import { loadInitialSearch } from "./initial-search";
import type { RateLimiter } from "./rate-limit";

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

function discoveryDependencies(
  command: ReturnType<typeof searchCommand>["command"],
  rateLimiter: RateLimiter,
): DiscoveryRouteDependencies {
  return {
    commands: {
      searchJobs: command,
      getJob: { execute: vi.fn() } as never,
      compareJobs: { execute: vi.fn() } as never,
    },
    jobs: { suggestLocations: vi.fn(async () => []) },
    rateLimiter,
    nowMs: () => 1_000,
  };
}

function allowingRateLimiter(): RateLimiter {
  return {
    check: vi.fn(async () => ({
      allowed: true,
      remaining: 59,
      retryAfterSeconds: 0,
      resetAtMs: 61_000,
    })),
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
      {
        request: new Request("https://jobbbler.example/jobs?q=platform"),
        command,
        dependencies: discoveryDependencies(command, allowingRateLimiter()),
      },
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

    const rateLimiter = allowingRateLimiter();
    const initial = await loadInitialSearch(
      { limit: "999" },
      {
        request: new Request("https://jobbbler.example/jobs?limit=999"),
        command,
        dependencies: discoveryDependencies(command, rateLimiter),
      },
    );

    expect(initial).toEqual({
      input: { sort: "newest", limit: 20 },
      result: null,
      error: "Some search filters are invalid. Adjust them and search again.",
    });
    expect(searchCalls()).toBe(0);
    expect(rateLimiter.check).not.toHaveBeenCalled();
  });

  it("applies the public search rate limit before executing the server-rendered search", async () => {
    const { command, searchCalls } = searchCommand();
    const rateLimiter: RateLimiter = {
      check: vi.fn(async () => ({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 17,
        resetAtMs: 18_000,
      })),
    };
    const request = new Request("https://jobbbler.example/jobs?q=platform");

    const initial = await loadInitialSearch(
      { q: "platform" },
      {
        request,
        command,
        dependencies: discoveryDependencies(command, rateLimiter),
      },
    );

    expect(initial).toMatchObject({
      input: { query: "platform", sort: "relevance", limit: 20 },
      result: null,
      error: "Search is briefly busy. Please retry in a moment.",
    });
    expect(rateLimiter.check).toHaveBeenCalledOnce();
    expect(searchCalls()).toBe(0);
  });

  it("keeps an injected command deterministic and outside the production result cache", async () => {
    const { command, searchCalls } = searchCommand();
    const dependencies = discoveryDependencies(command, allowingRateLimiter());
    const options = {
      request: new Request("https://jobbbler.example/jobs?q=injected-cache-probe"),
      command,
      dependencies,
    };

    await loadInitialSearch({ q: "injected-cache-probe" }, options);
    await loadInitialSearch({ q: "injected-cache-probe" }, options);

    expect(searchCalls()).toBe(2);
  });
});
