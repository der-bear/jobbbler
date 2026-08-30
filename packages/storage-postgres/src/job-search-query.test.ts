import { describe, expect, it, vi } from "vitest";

import type { Job, JobSearchQuery } from "@jobbbler/storage";

import type { PostgresSql } from "./connection.js";

const postgres = vi.hoisted(() => ({ sql: undefined as unknown }));

vi.mock("./connection.js", () => ({
  openPostgresDatabase: () => postgres.sql,
}));

import { createPostgresStorage } from "./storage.js";

const criteria: JobSearchQuery["criteria"] = {
  query: "engineer",
  categories: [],
  workModels: [],
  seniorities: [],
  locations: [],
  skills: [],
  excludeKeywords: [],
  salary: null,
  postedWithinDays: null,
  sort: "newest",
  cursor: null,
  limit: 20,
  unresolvedAssumptions: [],
};

function job(
  id: string,
  publishedAt: string,
  updatedAt: string,
  status: Job["status"] = "open",
): Job {
  return {
    id,
    organizationId: "org_550e8400-e29b-41d4-a716-446655440000",
    organizationName: "Northstar Systems",
    title: "Platform Engineer",
    summary: "Build reliable TypeScript services.",
    categories: ["software_engineering"],
    workModel: "remote",
    employmentType: "full_time",
    seniority: "senior",
    locations: ["Europe"],
    skills: ["TypeScript", "PostgreSQL"],
    salary: null,
    source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
    applyMode: "external",
    status,
    publishedAt,
    updatedAt,
  };
}

describe("PostgreSQL job text search", () => {
  it("returns a page from one bounded projection query without hydrating every match", async () => {
    const older = job(
      `${"j".repeat(31)}_550e8400-e29b-41d4-a716-446655440001`,
      "2026-08-27T09:00:00.000Z",
      "2026-08-29T09:00:00.000Z",
    );
    const newer = job(
      "job_550e8400-e29b-41d4-a716-446655440002",
      "2026-08-28T09:00:00.000Z",
      "2026-08-29T10:00:00.000Z",
    );
    const oldest = job(
      "job_550e8400-e29b-41d4-a716-446655440003",
      "2026-08-26T09:00:00.000Z",
      "2026-08-29T08:00:00.000Z",
    );
    const primary = Number.MAX_VALUE;
    const query = Object.assign(
      vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const statement = strings.join("?");
        expect(statement).toContain("jobbbler.job_search_documents");
        expect(statement).toContain("LIMIT");
        expect(statement).not.toMatch(/SELECT\s+job_id\s+FROM\s+jobbbler\.job_search_documents/iu);
        expect(values).toContain(3);
        return query.mock.calls.length === 1
          ? [
              {
                total: "3",
                catalog_updated_at: newer.updatedAt,
                page: [
                  { body: newer, primary, published_at: newer.publishedAt, job_id: newer.id },
                  { body: older, primary, published_at: older.publishedAt, job_id: older.id },
                  { body: oldest, primary, published_at: oldest.publishedAt, job_id: oldest.id },
                ],
              },
            ]
          : [
              {
                total: "3",
                catalog_updated_at: newer.updatedAt,
                page: [
                  { body: oldest, primary, published_at: oldest.publishedAt, job_id: oldest.id },
                ],
              },
            ];
      }),
      {
        array: vi.fn((items: readonly unknown[]) => items),
        json: vi.fn((value: unknown) => value),
      },
    );
    postgres.sql = query as unknown as PostgresSql;
    const storage = createPostgresStorage("postgresql://unused.test/jobbbler");

    const first = await storage.jobs.search({
      criteria: { ...criteria, sort: "salary_desc", limit: 2 },
      now: "2026-08-30T09:00:00.000Z",
      limit: 2,
    });
    expect(first).toEqual({
      jobs: [newer, older],
      total: 3,
      nextCursor: expect.any(String),
      catalogUpdatedAt: newer.updatedAt,
    });
    expect(first.nextCursor?.length).toBeLessThanOrEqual(256);

    await expect(
      storage.jobs.search({
        criteria: { ...criteria, sort: "salary_desc", cursor: first.nextCursor, limit: 2 },
        now: "2026-08-30T09:00:00.000Z",
        limit: 2,
      }),
    ).resolves.toEqual({
      jobs: [oldest],
      total: 3,
      nextCursor: null,
      catalogUpdatedAt: newer.updatedAt,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
