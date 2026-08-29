import {
  compareJobsInputSchema,
  compareJobsResultSchema,
  type CompareJobsInput,
  type CompareJobsResult,
  type JobSearchInput,
} from "@jobbbler/contracts";
import { type ApplicationCommand, type CommandContext, DomainError } from "@jobbbler/core-domain";

import { assessJobFit, type JobFit, toSafeJob } from "./fit.js";
import type { JobCatalogRepository } from "./search-jobs-command.js";
import { normalizeJobSearchCriteria } from "./search-criteria.js";

export type CompareJobsCommandInput = CompareJobsInput;

export interface ComparedJob {
  readonly job: ReturnType<typeof toSafeJob>;
  readonly fit: JobFit;
}

export type CompareJobsCommandOutput = CompareJobsResult;

function parseCompareInput(input: CompareJobsCommandInput): {
  readonly jobIds: readonly string[];
  readonly criteria: JobSearchInput;
} {
  const parsed = compareJobsInputSchema.parse(input);
  return { jobIds: parsed.jobIds, criteria: parsed.criteria ?? {} };
}

export function createCompareJobsCommand(
  jobs: JobCatalogRepository,
): ApplicationCommand<CompareJobsCommandInput, CompareJobsCommandOutput> {
  return {
    name: "compare_jobs",
    async execute(context: CommandContext, input) {
      const parsed = parseCompareInput(input);
      const criteria = normalizeJobSearchCriteria(parsed.criteria);
      const selected = await Promise.all(parsed.jobIds.map((jobId) => jobs.getById(jobId)));
      const missing = selected.find((job) => job === null || job.status !== "open");
      if (missing !== undefined) {
        throw new DomainError({ code: "NOT_FOUND", message: "One or more jobs were not found." });
      }

      const now = context.clock.now();
      return compareJobsResultSchema.parse({
        criteria,
        jobs: selected.map((job) => {
          const current = job!;
          return {
            job: toSafeJob(current),
            fit: assessJobFit(current, criteria, now),
          };
        }),
      });
    },
  };
}
