import {
  createCompareJobsCommand,
  createGetJobCommand,
  createSearchJobsCommand,
  type JobCatalogRepository,
} from "@jobbbler/jobs-domain";

import { getServerStorage } from "./context";
import { createMemoryRateLimiter, type RateLimiter } from "./rate-limit";

export interface DiscoveryCommands {
  readonly searchJobs: ReturnType<typeof createSearchJobsCommand>;
  readonly getJob: ReturnType<typeof createGetJobCommand>;
  readonly compareJobs: ReturnType<typeof createCompareJobsCommand>;
}

export interface DiscoveryRouteDependencies {
  readonly commands: DiscoveryCommands;
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

  const dependencies: DiscoveryRouteDependencies = {
    commands: createDiscoveryCommands(getServerStorage().jobs),
    rateLimiter: createMemoryRateLimiter(),
    nowMs: Date.now,
  };
  globalRegistry.__jobbblerDiscoveryDependencies = dependencies;
  return dependencies;
}
