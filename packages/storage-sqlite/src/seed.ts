import { readFile } from "node:fs/promises";

import { jobSchema } from "@jobbbler/contracts";
import type { Job } from "@jobbbler/contracts";
import type { OrganizationRecord } from "@jobbbler/storage";

import { createSqliteStorage } from "./storage.js";

const seededAt = "2026-08-29T00:00:00.000Z";

interface DemoOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly website: string | null;
  readonly description: string;
}

interface DemoCatalog {
  readonly version: 1;
  readonly organizations: DemoOrganization[];
  readonly jobs: Job[];
}

export interface SeedCatalogResult {
  readonly organizations: number;
  readonly jobs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOrganization(value: unknown): DemoOrganization {
  if (!isRecord(value)) throw new Error("Demo organization must be an object.");
  const { id, name, slug, website, description } = value;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof slug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    (website !== null && typeof website !== "string") ||
    typeof description !== "string"
  ) {
    throw new Error("Demo organization contains invalid fields.");
  }
  if (website !== null) new URL(website);
  return { id, name, slug, website, description };
}

function parseCatalog(value: unknown): DemoCatalog {
  if (
    !isRecord(value) ||
    value["version"] !== 1 ||
    !Array.isArray(value["organizations"]) ||
    !Array.isArray(value["jobs"])
  ) {
    throw new Error("Demo catalog must use the supported version and array structure.");
  }
  const organizations = value["organizations"].map(parseOrganization);
  const jobs = value["jobs"].map((job) => jobSchema.parse(job));
  if (organizations.length < 12 || jobs.length < 36) {
    throw new Error("Demo catalog does not meet the minimum presentation coverage.");
  }
  return { version: 1, organizations, jobs };
}

/** The two repositories the demo catalog writes to; any storage adapter provides them. */
export interface CatalogSeedTarget {
  readonly organizations: { upsert(record: OrganizationRecord): Promise<unknown> };
  readonly jobs: { upsert(job: Job): Promise<unknown> };
}

/**
 * Upserts the fixture catalog into an already-open storage adapter by id, so a
 * later run refreshes organizations and jobs in place and leaves every other
 * table alone. The caller owns the adapter's lifetime.
 */
export async function seedDemoCatalogInto(
  storage: CatalogSeedTarget,
  fixturePath: string,
): Promise<SeedCatalogResult> {
  const source = await readFile(fixturePath, "utf8");
  const catalog = parseCatalog(JSON.parse(source) as unknown);
  const organizationIds = new Set(catalog.organizations.map(({ id }) => id));

  for (const job of catalog.jobs) {
    if (!organizationIds.has(job.organizationId)) {
      throw new Error(`Demo job ${job.id} references an unknown organization.`);
    }
  }

  for (const organization of catalog.organizations) {
    const record: OrganizationRecord = {
      ...organization,
      createdAt: seededAt,
      updatedAt: seededAt,
    };
    await storage.organizations.upsert(record);
  }
  for (const job of catalog.jobs) await storage.jobs.upsert(job);

  return { organizations: catalog.organizations.length, jobs: catalog.jobs.length };
}

export async function seedDemoCatalog(
  databasePath: string,
  fixturePath: string,
): Promise<SeedCatalogResult> {
  const storage = createSqliteStorage(databasePath);
  try {
    return await seedDemoCatalogInto(storage, fixturePath);
  } finally {
    storage.close();
  }
}
