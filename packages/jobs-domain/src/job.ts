import { jobSchema, type Job as ContractJob } from "@jobbbler/contracts";

export type Job = ContractJob;

export function parseJob(input: unknown): Job {
  return jobSchema.parse(input);
}

export function getJobSearchDocument(job: Job): string {
  return [
    job.title,
    job.organizationName,
    job.summary,
    ...job.categories,
    ...job.locations,
    ...job.skills,
  ].join(" ");
}
