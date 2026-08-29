import { z } from "zod";

import { jobIdSchema, type CompareJobsResult } from "@jobbbler/contracts";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import {
  completedWebMcpResult,
  safeWebMcpErrorResult,
  type CompletedWebMcpResult,
  type SafeWebMcpErrorResult,
} from "@/lib/webmcp-tool-result";

const emptyInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const satisfies JsonSchema;

const removeInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    jobId: {
      type: "string",
      description: "A job ID present in the visible comparison.",
      pattern: "^job_[0-9a-f-]{36}$",
    },
  },
  required: ["jobId"],
} as const satisfies JsonSchema;

const emptyInput = z.strictObject({});

export interface CompareToolDependencies {
  readonly selectedJobIds: readonly string[] | (() => readonly string[]);
  getComparison(options: Readonly<{ signal: AbortSignal }>): Promise<CompareJobsResult>;
  removeJobFromComparison(
    jobId: string,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<Readonly<{ jobIds: readonly string[] }>>;
  onComparisonCommitted(selection: Readonly<{ jobIds: readonly string[] }>): Promise<void> | void;
  onNavigate(href: string): Promise<void> | void;
  getCriteriaSearch?(): string;
}

type CompareToolOutput = CompletedWebMcpResult<JsonValue> | SafeWebMcpErrorResult;

function selectedJobIds(dependencies: CompareToolDependencies): readonly string[] {
  return typeof dependencies.selectedJobIds === "function"
    ? dependencies.selectedJobIds()
    : dependencies.selectedJobIds;
}

function short(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function compactComparison(result: CompareJobsResult): JsonValue {
  return {
    jobs: result.jobs.map(({ job, fit }) => ({
      id: job.id,
      title: short(job.title, 50),
      organization: short(job.organizationName, 35),
      matchScore: fit.score,
      eligible: fit.eligible,
      workModel: job.workModel,
      location: short(job.locations[0] ?? "Location not stated", 30),
      salaryMinimum: job.salary?.minimum ?? null,
      salaryCurrency: job.salary?.currency ?? null,
      unknownDimensions: Object.values(fit.dimensions).filter(
        (dimension) => dimension.status === "unknown",
      ).length,
    })),
  };
}

function selectionHref(jobIds: readonly string[], criteriaSearch: string): string {
  if (jobIds.length === 0) return "/";
  const parameters = new URLSearchParams(criteriaSearch);
  parameters.delete("id");
  for (const jobId of jobIds) parameters.append("id", jobId);
  return `/compare?${parameters.toString()}`;
}

export function createCompareToolManifests(
  dependencies: CompareToolDependencies,
): readonly ToolManifest<unknown, CompareToolOutput>[] {
  const getComparison: ToolManifest<unknown, CompareToolOutput> = {
    name: "get_comparison",
    purpose: "Read the complete source-backed comparison that is visible on the current page.",
    description:
      "Read the current one-to-three-role comparison, including fit evidence, compensation, provenance, and unknowns. Use when the user asks about the comparison already open.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        const result = await dependencies.getComparison({ signal });
        return completedWebMcpResult({
          summary: `Read the visible comparison of ${String(result.jobs.length)} technology role${result.jobs.length === 1 ? "" : "s"}.`,
          data: compactComparison(result),
          resources: result.jobs.map(({ job }) => ({
            type: "job",
            id: job.id,
            label: "Compared role",
          })),
          facts: [{ key: "compared_jobs", value: result.jobs.length }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Comparison state accepts no arguments.");
      }
    },
  };

  const removeJobFromComparison: ToolManifest<unknown, CompareToolOutput> = {
    name: "remove_job_from_comparison",
    purpose:
      "Remove one selected role from the current local comparison and update its visible URL.",
    description:
      "Remove a specified job from the comparison already open. Use only for a job ID in the visible set. This updates local page state and does not change server data.",
    inputSchema: removeInputJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const selection = selectedJobIds(dependencies);
        const parsed = z
          .strictObject({ jobId: jobIdSchema })
          .superRefine(({ jobId }, context) => {
            if (!selection.includes(jobId)) {
              context.addIssue({
                code: "custom",
                path: ["jobId"],
                message: "The job is not in the current comparison.",
              });
            }
          })
          .parse(input);
        const next = await dependencies.removeJobFromComparison(parsed.jobId, { signal });
        await dependencies.onComparisonCommitted(next);
        await dependencies.onNavigate(
          selectionHref(next.jobIds, dependencies.getCriteriaSearch?.() ?? ""),
        );
        return completedWebMcpResult({
          summary: `Removed one role; ${String(next.jobIds.length)} remain in the visible comparison.`,
          data: { jobIds: next.jobIds },
          resources: next.jobIds.map((jobId) => ({
            type: "job",
            id: jobId,
            label: "Role remaining in comparison",
          })),
          facts: [{ key: "remaining_jobs", value: next.jobIds.length }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "The selected job cannot be removed.");
      }
    },
  };

  return [getComparison, removeJobFromComparison];
}
