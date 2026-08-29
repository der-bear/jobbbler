import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { storageContractSuite } from "@jobbbler/storage/contract-tests";
import type { Job, JobSearchCriteria } from "@jobbbler/contracts";

import { createSqliteStorage } from "./index.js";

const temporaryDirectories: string[] = [];

storageContractSuite("SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jobbbler-storage-contract-"));
  temporaryDirectories.push(directory);
  return createSqliteStorage(join(directory, "jobbbler.sqlite"));
});

describe("SQLite relevance candidate completeness", () => {
  it("does not discard an older, stronger match before ranking", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-storage-completeness-"));
    temporaryDirectories.push(directory);
    const storage = createSqliteStorage(join(directory, "jobbbler.sqlite"));
    const organizationId = "org_10000000-0000-7000-8000-000000000001";
    await storage.organizations.upsert({
      id: organizationId,
      name: "Fictional Scale Lab",
      slug: "fictional-scale-lab",
      website: null,
      description: "A fictional organization used for storage contract verification.",
      createdAt: "2026-08-29T10:00:00.000Z",
      updatedAt: "2026-08-29T10:00:00.000Z",
    });

    const makeJob = (index: number, skills: string[], publishedAt: string): Job => ({
      id: `job_10000000-0000-7000-8000-${index.toString(16).padStart(12, "0")}`,
      organizationId,
      organizationName: "Fictional Scale Lab",
      title: `Platform Engineer ${String(index)}`,
      summary: "Build and operate a fictional developer platform.",
      categories: ["software_engineering"],
      workModel: "remote",
      employmentType: "full_time",
      seniority: "senior",
      locations: ["Europe"],
      skills,
      salary: null,
      source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
      applyMode: "external",
      status: "open",
      publishedAt,
      updatedAt: "2026-08-29T10:00:00.000Z",
    });

    for (let index = 1; index <= 1_000; index += 1) {
      await storage.jobs.upsert(makeJob(index, ["TypeScript"], "2026-08-28T10:00:00.000Z"));
    }
    const strongest = makeJob(1_001, ["Rust"], "2026-01-01T10:00:00.000Z");
    await storage.jobs.upsert(strongest);

    const criteria: JobSearchCriteria = {
      query: null,
      categories: [],
      workModels: [],
      seniorities: [],
      locations: [],
      skills: ["Rust"],
      excludeKeywords: [],
      salary: null,
      postedWithinDays: null,
      sort: "relevance",
      cursor: null,
      limit: 1,
      unresolvedAssumptions: [],
    };
    const result = await storage.jobs.search({
      criteria,
      now: "2026-08-29T10:00:00.000Z",
      limit: 1,
    });

    expect(result.jobs).toEqual([strongest]);
    expect(result.total).toBe(1_001);
    expect(result.nextCursor).toEqual(expect.any(String));
    storage.close();
  }, 15_000);
});

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
