import { describe, expect, it, vi } from "vitest";

import type { Job } from "@jobbbler/contracts";
import type { JobCatalogRepository } from "@jobbbler/jobs-domain";

import { createDiscoveryCommands, type DiscoveryRouteDependencies } from "@/server/commands";
import {
  handleCompareRequest,
  handleJobDetailRequest,
  handleLocationSuggestionsRequest,
  handleSearchRequest,
} from "@/server/job-route-handlers";
import type { RateLimiter } from "@/server/rate-limit";

const first: Job = {
  id: "job_550e8400-e29b-41d4-a716-446655440000",
  organizationId: "org_550e8400-e29b-41d4-a716-446655440000",
  organizationName: "Northstar Systems",
  title: "Senior Product Engineer",
  summary: "Build TypeScript product workflows.",
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

const second: Job = {
  ...first,
  id: "job_650e8400-e29b-41d4-a716-446655440000",
  title: "Staff Platform Engineer",
  skills: ["Go", "Kubernetes"],
};

function repository(): JobCatalogRepository {
  return {
    getById: vi.fn(async (id: string) =>
      id === first.id ? first : id === second.id ? second : null,
    ),
    search: vi.fn(async () => ({
      jobs: [first],
      total: 7,
      nextCursor: null,
      catalogUpdatedAt: first.updatedAt,
    })),
  };
}

const allowingLimiter: RateLimiter = {
  check: vi.fn(async () => ({
    allowed: true,
    remaining: 59,
    retryAfterSeconds: 0,
    resetAtMs: 61_000,
  })),
};

function dependencies(rateLimiter: RateLimiter = allowingLimiter): DiscoveryRouteDependencies {
  return {
    commands: createDiscoveryCommands(repository()),
    jobs: {
      suggestLocations: vi.fn(async () => ["Berlin, Germany", "Europe"]),
    },
    rateLimiter,
    nowMs: () => 1_000,
  };
}

describe("job discovery API routes", () => {
  it("returns validated, explainable search results from URL state", async () => {
    const response = await handleSearchRequest(
      new Request("https://jobbbler.example/api/v1/jobs/search?q=TypeScript&work=remote&limit=10"),
      dependencies(),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect(response.headers.get("ratelimit-remaining")).toBe("59");
    expect(body).toMatchObject({
      ok: true,
      data: {
        criteria: { query: "TypeScript", workModels: ["remote"], limit: 10 },
        jobs: [{ id: first.id, matchScore: expect.any(Number) }],
        total: 7,
      },
    });
  });

  it("rejects invalid search state through the stable error envelope", async () => {
    const response = await handleSearchRequest(
      new Request("https://jobbbler.example/api/v1/jobs/search?limit=999"),
      dependencies(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION", retryable: false },
    });
  });

  it("returns job detail with fit and preserves public caching", async () => {
    const response = await handleJobDetailRequest(
      new Request(`https://jobbbler.example/api/v1/jobs/${first.id}?skill=TypeScript`),
      { params: Promise.resolve({ id: first.id }) },
      dependencies(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        job: { id: first.id },
        fit: { eligible: true, evidence: expect.arrayContaining(["Matched skills: TypeScript."]) },
      },
    });
  });

  it("compares one to three jobs in requested order", async () => {
    const response = await handleCompareRequest(
      new Request(
        `https://jobbbler.example/api/v1/jobs/compare?id=${second.id}&id=${first.id}&skill=Go`,
      ),
      dependencies(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly data: { readonly jobs: readonly { readonly job: { readonly id: string } }[] };
    };
    expect(body.data.jobs.map(({ job }) => job.id)).toEqual([second.id, first.id]);
  });

  it("returns retry guidance before invoking a rate-limited command", async () => {
    const denied: RateLimiter = {
      check: vi.fn(async () => ({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 17,
        resetAtMs: 18_000,
      })),
    };
    const response = await handleSearchRequest(
      new Request("https://jobbbler.example/api/v1/jobs/search"),
      dependencies(denied),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
  });

  it("lazy-loads bounded location suggestions from the catalog index", async () => {
    const current = dependencies();
    const response = await handleLocationSuggestionsRequest(
      new Request("https://jobbbler.example/api/v1/jobs/locations?q=ber&limit=8"),
      current,
    );

    expect(response.status).toBe(200);
    expect(current.jobs.suggestLocations).toHaveBeenCalledWith("ber", 8);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { locations: ["Berlin, Germany", "Europe"] },
    });
  });

  it("rejects an empty location lookup without scanning the catalog index", async () => {
    const current = dependencies();
    const response = await handleLocationSuggestionsRequest(
      new Request("https://jobbbler.example/api/v1/jobs/locations?limit=8"),
      current,
    );

    expect(response.status).toBe(400);
    expect(current.jobs.suggestLocations).not.toHaveBeenCalled();
  });
});
