import {
  type Job,
  type JobDetailInput,
  type JobDetailResult,
  type JobSearchCriteria,
  type JobSearchInput,
  type SearchJobsResult,
  jobDetailInputSchema,
  jobDetailResultSchema,
  searchJobsResultSchema,
} from "@jobbbler/contracts";
import { type ApplicationCommand, DomainError } from "@jobbbler/core-domain";

import { assessJobFit, toSafeJobDetail, toSafeJobSummary } from "./fit.js";
import { normalizeJobSearchCriteria } from "./search-criteria.js";

/**
 * The read-side port is intentionally structural so an adapter can pass
 * `Storage.jobs` without making the domain package depend on storage.
 */
export interface JobCatalogRepository {
  getById(id: string): Promise<Job | null>;
  search(input: {
    readonly criteria: JobSearchCriteria;
    readonly now: string;
    readonly limit: number;
  }): Promise<{
    readonly jobs: readonly Job[];
    readonly total: number;
    readonly nextCursor: string | null;
    readonly catalogUpdatedAt: string | null;
  }>;
}

export type SearchJobsCommandInput = JobSearchInput;
export type SearchJobsCommandOutput = SearchJobsResult;

export type GetJobCommandInput = JobDetailInput;
export type GetJobCommandOutput = JobDetailResult;

function parseGetJobInput(input: GetJobCommandInput): {
  readonly jobId: string;
  readonly criteria: JobSearchCriteria;
} {
  const parsed = jobDetailInputSchema.parse(input);
  return {
    jobId: parsed.jobId,
    criteria: normalizeJobSearchCriteria(parsed.criteria ?? {}),
  };
}

export function createSearchJobsCommand(
  jobs: JobCatalogRepository,
): ApplicationCommand<SearchJobsCommandInput, SearchJobsCommandOutput> {
  return {
    name: "search_jobs",
    async execute(context, input) {
      const criteria = normalizeJobSearchCriteria(input);
      const now = context.clock.now();
      const page = await jobs.search({ criteria, now: now.toISOString(), limit: criteria.limit });
      const summaries = page.jobs.map((job) =>
        toSafeJobSummary(job, assessJobFit(job, criteria, now)),
      );

      return searchJobsResultSchema.parse({
        criteria,
        jobs: summaries,
        total: page.total,
        nextCursor: page.nextCursor,
        /*
         * Passed through untouched. Coalescing an unknown timestamp to `now`
         * turned "we do not know" into "just updated" — a freshness claim the
         * product cannot support, shown precisely when a search returns
         * nothing and the person is already wondering whether it works.
         */
        catalogUpdatedAt: page.catalogUpdatedAt,
        warnings: [],
      });
    },
  };
}

export function createGetJobCommand(
  jobs: JobCatalogRepository,
): ApplicationCommand<GetJobCommandInput, GetJobCommandOutput> {
  return {
    name: "get_job",
    async execute(context, input) {
      const parsed = parseGetJobInput(input);
      const job = await jobs.getById(parsed.jobId);
      if (job === null || job.status !== "open") {
        throw new DomainError({ code: "NOT_FOUND", message: "Job was not found." });
      }
      return jobDetailResultSchema.parse({
        job: toSafeJobDetail(job),
        fit: assessJobFit(job, parsed.criteria, context.clock.now()),
      });
    },
  };
}
