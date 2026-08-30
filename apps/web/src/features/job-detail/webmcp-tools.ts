import { z } from "zod";

import {
  jobIdSchema,
  type CompareJobsInput,
  type CompareJobsResult,
  type JobDetailInput,
  type JobDetailResult,
} from "@jobbbler/contracts";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import {
  completedWebMcpResult,
  safeWebMcpErrorResult,
  type CompletedWebMcpResult,
  type SafeWebMcpErrorResult,
} from "@/lib/webmcp-tool-result";

import { applicationCapabilityData, applicationCapabilitySummary } from "./application-capability";

const jobIdProperty = {
  type: "string",
  description: "A Jobbbler job ID returned by search_jobs or another Jobbbler tool.",
  pattern: "^job_[0-9a-f-]{36}$",
} as const satisfies JsonSchema;

const detailInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { jobId: jobIdProperty },
  required: ["jobId"],
} as const satisfies JsonSchema;

const comparisonInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    jobIds: {
      type: "array",
      description: "Two or three distinct job IDs returned by Jobbbler tools.",
      minItems: 2,
      maxItems: 3,
      uniqueItems: true,
      items: jobIdProperty,
    },
  },
  required: ["jobIds"],
} as const satisfies JsonSchema;

export interface JobDetailToolDependencies {
  readonly currentJobId?: string;
  getJobDetails(
    input: JobDetailInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<JobDetailResult>;
  compareJobs(
    input: CompareJobsInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<CompareJobsResult>;
  onDetailCommitted(result: JobDetailResult): Promise<void> | void;
  onNavigate(href: string): Promise<void> | void;
  getCriteriaSearch?(): string;
}

type JobDetailToolOutput = CompletedWebMcpResult<JsonValue> | SafeWebMcpErrorResult;

function short(value: string, maximum = 160): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function detailData(result: JobDetailResult): JsonValue {
  return {
    id: result.job.id,
    title: short(result.job.title, 70),
    organization: short(result.job.organizationName, 50),
    summary: short(result.job.summary, 120),
    workModel: result.job.workModel,
    locations: result.job.locations.slice(0, 1).map((location) => short(location, 40)),
    seniority: result.job.seniority,
    skills: result.job.skills.slice(0, 3).map((skill) => short(skill, 30)),
    salary:
      result.job.salary === null
        ? null
        : {
            minimum: result.job.salary.minimum,
            maximum: result.job.salary.maximum,
            currency: result.job.salary.currency,
            period: result.job.salary.period,
          },
    matchScore: result.fit.score,
    evidence: result.fit.evidence.slice(0, 2).map((item) => short(item, 60)),
    source: short(result.job.source.label, 60),
    updatedAt: result.job.updatedAt,
  };
}

function comparisonData(result: CompareJobsResult): JsonValue {
  return {
    jobs: result.jobs.map(({ job, fit }) => ({
      id: job.id,
      title: short(job.title, 55),
      organization: short(job.organizationName, 40),
      matchScore: fit.score,
      workModel: job.workModel,
      location: short(job.locations[0] ?? "Location not stated", 32),
      salaryMinimum: job.salary?.minimum ?? null,
      salaryCurrency: job.salary?.currency ?? null,
    })),
  };
}

function comparisonHref(jobIds: readonly string[], criteriaSearch: string): string {
  const parameters = new URLSearchParams(criteriaSearch);
  parameters.delete("id");
  for (const jobId of jobIds) parameters.append("id", jobId);
  return `/compare?${parameters.toString()}`;
}

export function createJobDetailToolManifests(
  dependencies: JobDetailToolDependencies,
): readonly ToolManifest<unknown, JobDetailToolOutput>[] {
  const currentDetailInput = z.strictObject({ jobId: jobIdSchema });
  const currentComparisonInput = z
    .strictObject({ jobIds: z.array(jobIdSchema).min(1).max(3) })
    .superRefine((input, context) => {
      if (new Set(input.jobIds).size !== input.jobIds.length) {
        context.addIssue({
          code: "custom",
          path: ["jobIds"],
          message: "Job IDs must be unique.",
        });
      }
      if (input.jobIds.length < 2) {
        context.addIssue({
          code: "custom",
          path: ["jobIds"],
          message: "Select another job before comparing.",
        });
      }
    });

  const getJobDetails: ToolManifest<unknown, JobDetailToolOutput> = {
    name: "get_job_details",
    purpose: "Inspect source-backed facts and fit evidence for one explicitly identified role.",
    description:
      "Read one technology role's provenance, compensation, known unknowns, and fit evidence by Jobbbler ID. It works from any page and changes nothing.",
    inputSchema: detailInputJsonSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = currentDetailInput.parse(input);
        const result = await dependencies.getJobDetails(parsed, { signal });
        await dependencies.onDetailCommitted(result);
        return completedWebMcpResult({
          summary: "Read the role and its source-backed fit evidence.",
          data: detailData(result),
          resources: [
            {
              type: "job",
              id: result.job.id,
              label: short(`${result.job.title} at ${result.job.organizationName}`, 70),
            },
          ],
          facts: [{ key: "match_score", value: result.fit.score }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Provide one valid Jobbbler job ID.");
      }
    },
  };

  const compareJobs: ToolManifest<unknown, JobDetailToolOutput> = {
    name: "compare_jobs",
    purpose: "Compare two or three explicitly identified technology roles.",
    description:
      "Compare source-backed roles only after two or three exact job IDs are known, then open the visible comparison. Never call it with one role; if a target is missing, search or ask which other role to compare first.",
    inputSchema: comparisonInputJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = currentComparisonInput.parse(input);
        const result = await dependencies.compareJobs(parsed, { signal });
        await dependencies.onNavigate(
          comparisonHref(parsed.jobIds, dependencies.getCriteriaSearch?.() ?? ""),
        );
        return completedWebMcpResult({
          summary: `Compared ${String(result.jobs.length)} technology roles and opened the comparison.`,
          data: comparisonData(result),
          resources: result.jobs.map(({ job }) => ({
            type: "job",
            id: job.id,
            label: short(`${job.title} at ${job.organizationName}`, 60),
          })),
          facts: [{ key: "compared_jobs", value: result.jobs.length }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "The comparison request is invalid.");
      }
    },
  };

  const getApplicationCapability: ToolManifest<unknown, JobDetailToolOutput> = {
    name: "get_job_application_capability",
    purpose: "Learn how one explicitly identified role accepts applications before starting one.",
    description:
      "Read one role's application capability by Jobbbler ID: whether Jobbbler can prepare it, which steps stay with the human, and whether an external handoff is required.",
    inputSchema: detailInputJsonSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = currentDetailInput.parse(input);
        const result = await dependencies.getJobDetails(parsed, { signal });
        return completedWebMcpResult({
          summary: applicationCapabilitySummary(result.job),
          data: applicationCapabilityData(result.job),
          resources: [
            {
              type: "job",
              id: result.job.id,
              label: short(`${result.job.title} at ${result.job.organizationName}`, 70),
            },
          ],
          facts: [{ key: "apply_mode", value: result.job.applyMode }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "The capability request is invalid.");
      }
    },
  };

  return [getJobDetails, getApplicationCapability, compareJobs];
}
