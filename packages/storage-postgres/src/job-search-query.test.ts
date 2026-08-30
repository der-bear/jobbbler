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
  it("returns the existing filtered order with at most two queries regardless of match count", async () => {
    const older = job(
      "job_550e8400-e29b-41d4-a716-446655440001",
      "2026-08-27T09:00:00.000Z",
      "2026-08-29T09:00:00.000Z",
    );
    const newer = job(
      "job_550e8400-e29b-41d4-a716-446655440002",
      "2026-08-28T09:00:00.000Z",
      "2026-08-29T10:00:00.000Z",
    );
    const closed = job(
      "job_550e8400-e29b-41d4-a716-446655440003",
      "2026-08-29T09:00:00.000Z",
      "2026-08-29T11:00:00.000Z",
      "closed",
    );
    const missingId = "job_550e8400-e29b-41d4-a716-446655440004";
    const records = new Map([older, newer, closed].map((record) => [record.id, record]));
    const array = vi.fn((ids: readonly string[]) => ({ batchedIds: [...ids] }));
    const query = Object.assign(
      vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const statement = strings.join("?");
        if (statement.includes("job_search_documents")) {
          return [newer.id, older.id, closed.id, missingId].map((jobId) => ({ job_id: jobId }));
        }
        if (!statement.includes("jobbbler.entity_records")) {
          throw new Error(`Unexpected query: ${statement}`);
        }
        const batch = values.find(
          (value): value is { readonly batchedIds: readonly string[] } =>
            typeof value === "object" && value !== null && "batchedIds" in value,
        );
        const ids =
          batch?.batchedIds ??
          values.filter(
            (value): value is string => typeof value === "string" && records.has(value),
          );
        return ids.flatMap((id) => {
          const record = records.get(id);
          return record === undefined ? [] : [{ id, owner_id: null, body: record, version: 0 }];
        });
      }),
      { array },
    );
    postgres.sql = query as unknown as PostgresSql;
    const storage = createPostgresStorage("postgresql://unused.test/jobbbler");

    await expect(
      storage.jobs.search({
        criteria,
        now: "2026-08-30T09:00:00.000Z",
        limit: 20,
      }),
    ).resolves.toEqual({
      jobs: [newer, older],
      total: 2,
      nextCursor: null,
      catalogUpdatedAt: newer.updatedAt,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
