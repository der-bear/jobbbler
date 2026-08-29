import {
  jobSearchCriteriaSchema,
  jobFitSchema,
  type Job,
  type JobFit as JobFitContract,
  type JobSearchCriteria,
  type JobSearchInput,
  type JobSummary,
} from "@jobbbler/contracts";

import { rankJob } from "./ranking.js";
import { normalizeJobSearchCriteria } from "./search-criteria.js";

export type JobFit = JobFitContract;

const maximumPublicSummaryLength = 600;

function criteriaFrom(input: JobSearchInput | JobSearchCriteria): JobSearchCriteria {
  if ("unresolvedAssumptions" in input) return jobSearchCriteriaSchema.parse(input);
  return normalizeJobSearchCriteria(input);
}

export function capUntrustedText(
  value: string,
  maximumLength = maximumPublicSummaryLength,
): string {
  const withoutActiveContent = value
    .replace(
      /<(?:script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/(?:script|style|iframe|object|embed)\s*>/giu,
      " ",
    )
    .replace(/<[^>]*>/gu, " ")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (withoutActiveContent.length === 0) return "Details are unavailable.";
  if (withoutActiveContent.length <= maximumLength) return withoutActiveContent;
  return `${withoutActiveContent.slice(0, Math.max(0, maximumLength - 1)).trimEnd()}…`;
}

export function assessJobFit(
  job: Job,
  input: JobSearchInput | JobSearchCriteria,
  now: Date,
): JobFit {
  const rank = rankJob(job, criteriaFrom(input), { now });
  return jobFitSchema.parse({
    eligible: rank.eligible,
    score: rank.score,
    evidence: [...rank.evidence].slice(0, 12),
    caveats: [...rank.caveats].slice(0, 12),
    exclusions: [...rank.exclusions].slice(0, 12),
    dimensions: rank.dimensions,
  });
}

export function toSafeJob(job: Job): Job {
  return { ...job, summary: capUntrustedText(job.summary) };
}

export function toSafeJobSummary(job: Job, fit: JobFit): JobSummary {
  return {
    ...toSafeJob(job),
    matchScore: fit.score,
    matchEvidence: [...fit.evidence].slice(0, 12),
  };
}
