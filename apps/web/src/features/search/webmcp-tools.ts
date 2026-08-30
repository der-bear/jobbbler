import { z } from "zod";

import {
  entityIdSchema,
  jobCategorySchema,
  jobSearchInputSchema,
  salaryPeriodSchema,
  searchSortSchema,
  senioritySchema,
  unknownSalaryPolicySchema,
  workModelSchema,
  type JobSearchCriteria,
  type JobSearchInput,
  type SearchJobsResult,
} from "@jobbbler/contracts";
import { comparableCurrencies, normalizeJobSearchCriteria } from "@jobbbler/jobs-domain";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import { searchInputToSearchParams } from "@/lib/search-url";
import type { WebMcpNavigate } from "@/lib/webmcp-navigation";
import {
  MAX_EXACT_REVIEW_RESULT_BYTES,
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

const searchStateInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    detail: {
      type: "string",
      description: "summary for display; exact for criteria reusable by request_search_alert.",
      enum: ["summary", "exact"],
    },
  },
} as const satisfies JsonSchema;

export const jobSearchToolInputJsonSchema = {
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
    cursor: {
      type: "string",
      description:
        "Opaque nextCursor from search_jobs; keep every other search criterion unchanged.",
      maxLength: 256,
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
const searchStateInput = z.strictObject({
  detail: z.enum(["summary", "exact"]).default("summary"),
});
export const jobSearchToolInput = jobSearchInputSchema;

export interface SearchWebMcpState {
  readonly criteria: JobSearchCriteria;
  readonly total: number | null;
}

const openJobInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    jobId: {
      type: "string",
      description: "A job ID returned by search_jobs.",
      pattern: "^job_[0-9a-f-]{36}$",
    },
  },
  required: ["jobId"],
} as const satisfies JsonSchema;

const openJobInput = z.strictObject({ jobId: entityIdSchema });

export interface SearchToolDependencies {
  searchJobs(
    input: JobSearchInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<SearchJobsResult>;
  getSearchState(): JobSearchInput | SearchWebMcpState | null;
  onSearchCommitted(input: JobSearchInput, result: SearchJobsResult): Promise<void> | void;
  onNavigate: WebMcpNavigate;
  getCriteriaSearch?(): string;
}

type SearchToolOutput = CompletedWebMcpResult<JsonValue> | SafeWebMcpErrorResult;

function short(value: string, maximum = 80): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function compactCriteria(criteria: JobSearchCriteria): JsonValue {
  const omitted = {
    categories: Math.max(0, criteria.categories.length - 2),
    workModels: Math.max(0, criteria.workModels.length - 2),
    seniorities: Math.max(0, criteria.seniorities.length - 2),
    locations: Math.max(0, criteria.locations.length - 2),
    skills: Math.max(0, criteria.skills.length - 1),
    excludeKeywords: Math.max(0, criteria.excludeKeywords.length - 1),
    unresolvedAssumptions: Math.max(0, criteria.unresolvedAssumptions.length - 1),
  };
  const shortened: string[] = [];
  if (criteria.query !== null && criteria.query.length > 80) shortened.push("query");
  if (criteria.locations.some((value) => value.length > 32)) shortened.push("locations");
  if (criteria.skills.some((value) => value.length > 30)) shortened.push("skills");
  if (criteria.excludeKeywords.some((value) => value.length > 30)) {
    shortened.push("excludeKeywords");
  }
  if (criteria.unresolvedAssumptions.some((value) => value.length > 80)) {
    shortened.push("unresolvedAssumptions");
  }
  const complete = Object.values(omitted).every((count) => count === 0) && shortened.length === 0;

  return {
    query: criteria.query === null ? null : short(criteria.query, 80),
    categories: criteria.categories.slice(0, 2),
    workModels: criteria.workModels.slice(0, 2),
    seniorities: criteria.seniorities.slice(0, 2),
    locations: criteria.locations.slice(0, 2).map((value) => short(value, 32)),
    skills: criteria.skills.slice(0, 1).map((value) => short(value, 30)),
    excludeKeywords: criteria.excludeKeywords.slice(0, 1).map((value) => short(value, 30)),
    unresolvedAssumptions: criteria.unresolvedAssumptions
      .slice(0, 1)
      .map((value) => short(value, 80)),
    salaryMinimum: criteria.salary?.minimum ?? null,
    salaryMaximum: criteria.salary?.maximum ?? null,
    salaryCurrency: criteria.salary?.currency ?? null,
    salaryPeriod: criteria.salary?.period ?? null,
    unknownSalaryPolicy: criteria.salary?.unknownPolicy ?? null,
    postedWithinDays: criteria.postedWithinDays,
    sort: criteria.sort,
    limit: criteria.limit,
    cursorActive: criteria.cursor !== null,
    truncation: { complete, omitted, shortened },
  };
}

function reusableCriteria(criteria: JobSearchCriteria): JsonValue {
  return {
    ...(criteria.query === null ? {} : { query: criteria.query }),
    ...(criteria.categories.length === 0 ? {} : { categories: criteria.categories }),
    ...(criteria.workModels.length === 0 ? {} : { workModels: criteria.workModels }),
    ...(criteria.seniorities.length === 0 ? {} : { seniorities: criteria.seniorities }),
    ...(criteria.locations.length === 0 ? {} : { locations: criteria.locations }),
    ...(criteria.skills.length === 0 ? {} : { skills: criteria.skills }),
    ...(criteria.excludeKeywords.length === 0 ? {} : { excludeKeywords: criteria.excludeKeywords }),
    ...(criteria.salary === null
      ? {}
      : {
          salary: {
            ...(criteria.salary.minimum === null ? {} : { minimum: criteria.salary.minimum }),
            ...(criteria.salary.maximum === null ? {} : { maximum: criteria.salary.maximum }),
            ...(criteria.salary.currency === null ? {} : { currency: criteria.salary.currency }),
            period: criteria.salary.period,
            unknownPolicy: criteria.salary.unknownPolicy,
          },
        }),
    ...(criteria.postedWithinDays === null ? {} : { postedWithinDays: criteria.postedWithinDays }),
    sort: criteria.sort,
    limit: criteria.limit,
  };
}

function compactSearchResult(result: SearchJobsResult): JsonValue {
  return {
    total: result.total,
    jobs: result.jobs.slice(0, 3).map((job) => ({
      id: job.id,
      title: short(job.title, 45),
      organization: short(job.organizationName, 32),
      location: short(job.locations[0] ?? "Location not stated", 24),
      workModel: job.workModel,
      salaryMinimum: job.salary?.minimum ?? null,
      salaryCurrency: job.salary?.currency ?? null,
      matchScore: job.matchScore ?? null,
    })),
    nextCursor: result.nextCursor,
    hasMore: result.nextCursor !== null || result.total > result.jobs.length,
  };
}

export function createSearchToolManifests(
  dependencies: SearchToolDependencies,
): readonly ToolManifest<unknown, SearchToolOutput>[] {
  const searchJobs: ToolManifest<unknown, SearchToolOutput> = {
    name: "search_jobs",
    purpose: "Search the public technology-job catalog and synchronize the visible results.",
    description:
      "Search Jobbbler's source-backed technology roles with the preferences the person supplied. Ask for one useful preference when the request gives no role, skill, location, work model, or other search criterion. Applies validated criteria to the visible page and returns compact matches with IDs.",
    inputSchema: jobSearchToolInputJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = jobSearchToolInput.parse(input);
        const result = await dependencies.searchJobs(parsed, { signal });
        const parameters = searchInputToSearchParams(parsed);
        const href = parameters.size === 0 ? "/jobs" : `/jobs?${parameters.toString()}`;
        await dependencies.onNavigate(href, { signal });
        await dependencies.onSearchCommitted(parsed, result);
        return completedWebMcpResult({
          summary: `Found ${String(result.total)} matching technology role${result.total === 1 ? "" : "s"}.`,
          data: compactSearchResult(result),
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
    purpose: "Read the visible search constraints and result count without rerunning the search.",
    description:
      "Read the visible filters and result count. Use detail=summary for a bounded explanation, or detail=exact to receive complete criteria in the input shape accepted by request_search_alert. This never runs a new search.",
    inputSchema: searchStateInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = searchStateInput.parse(input);
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
        if (parsed.detail === "exact") {
          return completedWebMcpResult({
            summary: "Read the exact visible search criteria for reuse.",
            data: {
              ready: true,
              total: state.total,
              criteria: reusableCriteria(state.criteria),
            },
            facts: [{ key: "visible_total", value: state.total }],
            maximumBytes: MAX_EXACT_REVIEW_RESULT_BYTES,
          });
        }
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

  const getSearchFilters: ToolManifest<unknown, SearchToolOutput> = {
    name: "get_search_filters",
    purpose: "Read every filter value this site accepts before composing a search.",
    description:
      "Read Jobbbler's exact search vocabulary: accepted categories, work models, seniorities, salary options, and sort orders. Use instead of guessing enum values before calling search_jobs.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        return completedWebMcpResult({
          summary: "Read the accepted search filter vocabulary.",
          data: {
            categories: [...jobCategorySchema.options],
            workModels: [...workModelSchema.options],
            seniorities: [...senioritySchema.options],
            salary: {
              periods: [...salaryPeriodSchema.options],
              unknownPolicies: [...unknownSalaryPolicySchema.options],
              currency: "Any ISO 4217 code; cross-currency ranking supports these.",
              comparableCurrencies: [...comparableCurrencies],
            },
            sort: [...searchSortSchema.options],
            locations: "Free text: countries, regions, or cities.",
            skills: "Free text, matched against role skills.",
            postedWithinDays: { minimum: 1, maximum: 365 },
            limit: { minimum: 1, maximum: 50, default: 20 },
          },
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Search filters accept no arguments.");
      }
    },
  };

  const openJobDetails: ToolManifest<unknown, SearchToolOutput> = {
    name: "open_job_details",
    purpose: "Open one explicitly identified role while keeping the global toolset available.",
    description:
      "Navigate to a role returned by search_jobs while preserving the current criteria. Every Jobbbler tool stays registered across the navigation.",
    inputSchema: openJobInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = openJobInput.parse(input);
        const criteriaSearch = dependencies.getCriteriaSearch?.() ?? "";
        await dependencies.onNavigate(
          `/jobs/${encodeURIComponent(parsed.jobId)}${criteriaSearch.length === 0 ? "" : `?${criteriaSearch}`}`,
          { signal },
        );
        return completedWebMcpResult({
          summary: "Opened the role page and kept the global Jobbbler toolset available.",
          data: { jobId: parsed.jobId, route: "/jobs/:jobId" },
          resources: [{ type: "job", id: parsed.jobId, label: "Opened role" }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Provide one job ID from search_jobs.");
      }
    },
  };

  return [searchJobs, getSearchState, getSearchFilters, openJobDetails];
}
