import {
  createCompareJobsCommand,
  createGetJobCommand,
  createSearchJobsCommand,
  type JobCatalogRepository,
} from "@jobbbler/jobs-domain";
import type { JobRepository } from "@jobbbler/storage";

import { getServerStorage } from "./context";
import { createStorageRateLimiter, type RateLimiter } from "./rate-limit";

export interface DiscoveryCommands {
  readonly searchJobs: ReturnType<typeof createSearchJobsCommand>;
  readonly getJob: ReturnType<typeof createGetJobCommand>;
  readonly compareJobs: ReturnType<typeof createCompareJobsCommand>;
}

export interface DiscoveryRouteDependencies {
  readonly commands: DiscoveryCommands;
  readonly jobs: Pick<JobRepository, "suggestLocations">;
  readonly rateLimiter: RateLimiter;
  readonly nowMs: () => number;
}

export function createDiscoveryCommands(jobs: JobCatalogRepository): DiscoveryCommands {
  return {
    searchJobs: createSearchJobsCommand(jobs),
    getJob: createGetJobCommand(jobs),
    compareJobs: createCompareJobsCommand(jobs),
  };
}

const globalRegistry = globalThis as typeof globalThis & {
  __jobbblerDiscoveryDependencies?: DiscoveryRouteDependencies;
};

export function getDiscoveryRouteDependencies(): DiscoveryRouteDependencies {
  const existing = globalRegistry.__jobbblerDiscoveryDependencies;
  if (existing !== undefined) return existing;

  const storage = getServerStorage();
  const dependencies: DiscoveryRouteDependencies = {
    commands: createDiscoveryCommands(storage.jobs),
    jobs: storage.jobs,
    rateLimiter: createStorageRateLimiter(storage.rateLimits),
    nowMs: Date.now,
  };
  globalRegistry.__jobbblerDiscoveryDependencies = dependencies;
  return dependencies;
}
