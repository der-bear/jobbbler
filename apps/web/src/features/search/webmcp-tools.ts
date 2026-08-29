import { z } from "zod";

import {
  jobSearchInputSchema,
  type JobSearchCriteria,
  type JobSearchInput,
  type SearchJobsResult,
} from "@jobbbler/contracts";
import { normalizeJobSearchCriteria } from "@jobbbler/jobs-domain";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import { searchInputToSearchParams } from "@/lib/search-url";
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

const searchInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      description: "Technology role, skill, or outcome to search for.",
      maxLength: 500,
    },
    categories: {
      type: "array",
      description: "Technology job functions to include.",
      maxItems: 12,
      items: {
        type: "string",
        enum: [
          "software_engineering",
          "data_ai",
          "product",
          "design_research",
          "security",
          "infrastructure",
          "quality_assurance",
          "developer_relations",
          "technical_support_success",
          "technical_recruiting",
          "tech_operations_sales",
        ],
      },
    },
    workModels: {
      type: "array",
      description: "Allowed work arrangements.",
      maxItems: 4,
      items: { type: "string", enum: ["remote", "hybrid", "onsite", "flexible"] },
    },
    seniorities: {
      type: "array",
      description: "Seniority levels to include.",
      maxItems: 9,
      items: {
        type: "string",
        enum: [
          "entry",
          "mid",
          "senior",
          "staff",
          "principal",
          "lead",
          "manager",
          "director",
          "executive",
        ],
      },
    },
    locations: {
      type: "array",
      description: "Countries, regions, or cities to include.",
      maxItems: 12,
      items: { type: "string", maxLength: 120 },
    },
    skills: {
      type: "array",
      description: "Required technology skills.",
      maxItems: 20,
      items: { type: "string", maxLength: 120 },
    },
    excludeKeywords: {
      type: "array",
      description: "Keywords that must not appear in a matching role.",
      maxItems: 20,
      items: { type: "string", maxLength: 120 },
    },
    salary: {
      type: "object",
      description: "Annual, monthly, or hourly compensation constraint.",
      additionalProperties: false,
      properties: {
        minimum: { type: "number", minimum: 0 },
        maximum: { type: "number", minimum: 0 },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        period: { type: "string", enum: ["hour", "month", "year"] },
        unknownPolicy: { type: "string", enum: ["include", "exclude", "only"] },
      },
    },
    postedWithinDays: {
      type: "integer",
      description: "Maximum age of a posting in days.",
      minimum: 1,
      maximum: 365,
    },
    sort: {
      type: "string",
      description: "Result ordering.",
      enum: ["relevance", "newest", "salary_desc"],
    },
    limit: {
      type: "integer",
      description: "Number of visible results to request.",
      minimum: 1,
      maximum: 50,
    },
  },
} as const satisfies JsonSchema;

const emptyInput = z.strictObject({});
const publicJobSearchInput = jobSearchInputSchema.omit({ cursor: true });

export interface SearchWebMcpState {
  readonly criteria: JobSearchCriteria;
  readonly total: number | null;
}

export interface SearchToolDependencies {
  searchJobs(
    input: JobSearchInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<SearchJobsResult>;
  getSearchState(): JobSearchInput | SearchWebMcpState | null;
  onSearchCommitted(input: JobSearchInput, result: SearchJobsResult): Promise<void> | void;
  onNavigate(href: string): Promise<void> | void;
}

type SearchToolOutput = CompletedWebMcpResult<JsonValue> | SafeWebMcpErrorResult;

function short(value: string, maximum = 80): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function compactCriteria(criteria: JobSearchCriteria): JsonValue {
  return {
    query: criteria.query === null ? null : short(criteria.query, 80),
    categories: criteria.categories.slice(0, 2),
    workModels: criteria.workModels.slice(0, 2),
    seniorities: criteria.seniorities.slice(0, 2),
    locations: criteria.locations.slice(0, 2).map((value) => short(value, 32)),
    skills: criteria.skills.slice(0, 1).map((value) => short(value, 30)),
    excludeKeywords: criteria.excludeKeywords.slice(0, 1).map((value) => short(value, 30)),
    salaryMinimum: criteria.salary?.minimum ?? null,
    salaryCurrency: criteria.salary?.currency ?? null,
    postedWithinDays: criteria.postedWithinDays,
    sort: criteria.sort,
  };
}

function compactSearchResult(result: SearchJobsResult): JsonValue {
  return {
    total: result.total,
    jobs: result.jobs.slice(0, 2).map((job) => ({
      id: job.id,
      title: short(job.title, 55),
      organization: short(job.organizationName, 40),
      location: short(job.locations[0] ?? "Location not stated", 32),
      workModel: job.workModel,
      salaryMinimum: job.salary?.minimum ?? null,
      salaryCurrency: job.salary?.currency ?? null,
      matchScore: job.matchScore ?? null,
    })),
    hasMore: result.nextCursor !== null || result.total > 2,
  };
}

export function createSearchToolManifests(
  dependencies: SearchToolDependencies,
): readonly ToolManifest<unknown, SearchToolOutput>[] {
  const searchJobs: ToolManifest<unknown, SearchToolOutput> = {
    name: "search_jobs",
    purpose: "Search the public technology-job catalog and synchronize the visible results.",
    description:
      "Search Jobbbler's source-backed technology roles. Use for a new or refined job search. Applies validated criteria to the visible page and returns compact matches with IDs.",
    inputSchema: searchInputJsonSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = publicJobSearchInput.parse(input);
        const result = await dependencies.searchJobs(parsed, { signal });
        const parameters = searchInputToSearchParams(parsed);
        const href = parameters.size === 0 ? "/" : `/?${parameters.toString()}`;
        await dependencies.onNavigate(href);
        await dependencies.onSearchCommitted(parsed, result);
        return completedWebMcpResult({
          summary: `Found ${String(result.total)} matching technology role${result.total === 1 ? "" : "s"}.`,
          data: compactSearchResult(result),
          resources: result.jobs.slice(0, 2).map((job) => ({
            type: "job",
            id: job.id,
            label: short(`${job.title} at ${job.organizationName}`, 70),
          })),
          facts: [
            { key: "total", value: result.total },
            { key: "catalog_updated_at", value: result.catalogUpdatedAt },
          ],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "The job-search criteria are invalid.");
      }
    },
  };

  const getSearchState: ToolManifest<unknown, SearchToolOutput> = {
    name: "get_search_state",
    purpose:
      "Read the current visible search constraints and result count without rerunning search.",
    description:
      "Read the exact filters and result count currently visible on Jobbbler. Use before refining an existing search or explaining active constraints. This does not run a new search.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        const rawState = dependencies.getSearchState();
        if (rawState === null) {
          return completedWebMcpResult({
            summary: "The visible search is still preparing.",
            data: { ready: false },
          });
        }
        const state: SearchWebMcpState =
          "criteria" in rawState
            ? rawState
            : { criteria: normalizeJobSearchCriteria(rawState), total: null };
        return completedWebMcpResult({
          summary: "Read the visible search state.",
          data: {
            ready: true,
            total: state.total,
            criteria: compactCriteria(state.criteria),
          },
          facts: [{ key: "visible_total", value: state.total }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Search state accepts no arguments.");
      }
    },
  };

  return [searchJobs, getSearchState];
}
