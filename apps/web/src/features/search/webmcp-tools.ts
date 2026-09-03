import { z } from "zod";

import {
  entityIdSchema,
  employmentTypeSchema,
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
import { locationForSearch } from "@/lib/job-format";
import type { WebMcpNavigate } from "@/lib/webmcp-navigation";
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

const searchStateInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    detail: {
      type: "string",
      description:
        "summary for display; exact for criteria reusable by save_job_search or request_search_alert.",
      enum: ["summary", "exact"],
    },
  },
} as const satisfies JsonSchema;

export const jobSearchToolInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  allOf: [
    {
      if: {
        properties: { remoteOrLocations: { const: true } },
        required: ["remoteOrLocations"],
      },
      then: {
        required: ["locations"],
        properties: { locations: { minItems: 1 } },
      },
    },
  ],
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
    employmentTypes: {
      type: "array",
      description: "Employment arrangements that matching roles must use.",
      maxItems: 5,
      items: {
        type: "string",
        enum: ["full_time", "part_time", "contract", "freelance", "internship"],
      },
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
      description:
        "Cities, countries, or regions to include. Do not use Remote as a place; use remoteOrLocations for requests such as ‘Berlin or remote’.",
      maxItems: 12,
      items: { type: "string", maxLength: 120 },
    },
    remoteOrLocations: {
      type: "boolean",
      description:
        "Match listed locations OR remote roles anywhere. Requires a location; for remote-only, use workModels=['remote'].",
    },
    skills: {
      type: "array",
      description: "Technology skills to prefer in match ranking.",
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
      enum: ["relevance", "newest", "updated_desc", "salary_desc", "salary_asc"],
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

const searchJobsPageSize = 3;
const visibleSearchPageSize = 20;
const searchJobsToolInputJsonSchema = {
  ...jobSearchToolInputJsonSchema,
  properties: {
    ...jobSearchToolInputJsonSchema.properties,
    presentation: {
      type: "string",
      description:
        "headless keeps the current page unchanged; follow opens and synchronizes the visible search.",
      enum: ["headless", "follow"],
      default: "headless",
    },
    limit: {
      type: "integer",
      description:
        "Fixed agent page size. Omit this field or pass 3 so nextCursor reaches every result.",
      minimum: searchJobsPageSize,
      maximum: searchJobsPageSize,
      default: searchJobsPageSize,
    },
  },
} as const satisfies JsonSchema;

const emptyInput = z.strictObject({});
const searchStateInput = z.strictObject({
  detail: z.enum(["summary", "exact"]).default("summary"),
});
export const jobSearchToolInput = jobSearchInputSchema;
const searchJobsToolInput = jobSearchInputSchema.extend({
  limit: z.literal(searchJobsPageSize).default(searchJobsPageSize),
  presentation: z.enum(["headless", "follow"]).default("headless"),
});

export interface SearchWebMcpState {
  readonly criteria: JobSearchCriteria;
  readonly total: number | null;
  readonly presentation?: "headless" | "follow";
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
  onHeadlessSearchCommitted?(state: SearchWebMcpState): Promise<void> | void;
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
    employmentTypes: Math.max(0, (criteria.employmentTypes ?? []).length - 2),
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
    employmentTypes: (criteria.employmentTypes ?? []).slice(0, 2),
    seniorities: criteria.seniorities.slice(0, 2),
    locations: criteria.locations.slice(0, 2).map((value) => short(value, 32)),
    remoteOrLocations: criteria.remoteOrLocations === true,
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
    ...((criteria.employmentTypes ?? []).length === 0
      ? {}
      : { employmentTypes: criteria.employmentTypes ?? [] }),
    ...(criteria.seniorities.length === 0 ? {} : { seniorities: criteria.seniorities }),
    ...(criteria.locations.length === 0 ? {} : { locations: criteria.locations }),
    ...(criteria.remoteOrLocations === true ? { remoteOrLocations: true } : {}),
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

function compactSearchResult(
  result: SearchJobsResult,
  presentation: "headless" | "follow",
): JsonValue {
  const locationGuidance =
    result.total === 0 && result.criteria.locations.length > 0
      ? "No role matched the requested location and other filters. Keep the place literal: check its spelling, or ask before broadening or removing it."
      : null;
  return {
    presentation,
    total: result.total,
    jobs: result.jobs.slice(0, 3).map((job) => {
      const matchEvidence = (job.matchEvidence ?? []).slice(0, 2).map((value) => short(value, 72));
      return {
        id: job.id,
        title: short(job.title, 80),
        organization: short(job.organizationName, 32),
        location: short(
          locationForSearch(job.locations, result.criteria.locations) ?? "Location not stated",
          24,
        ),
        workModel: job.workModel,
        seniority: job.seniority,
        salaryMinimum: job.salary?.minimum ?? null,
        salaryMaximum: job.salary?.maximum ?? null,
        salaryCurrency: job.salary?.currency ?? null,
        salaryPeriod: job.salary?.period ?? null,
        ...(matchEvidence.length === 0 ? {} : { matchEvidence }),
      };
    }),
    nextCursor: result.nextCursor,
    hasMore: result.nextCursor !== null,
    ...(locationGuidance === null ? {} : { locationGuidance }),
  };
}

export function createSearchToolManifests(
  dependencies: SearchToolDependencies,
): readonly ToolManifest<unknown, SearchToolOutput>[] {
  const searchJobs: ToolManifest<unknown, SearchToolOutput> = {
    name: "search_jobs",
    purpose: "Search Jobbbler's public technology roles without leaving the current page.",
    description:
      "Search Jobbbler's source-backed catalog directly. Do not use external job sources when the person asks for this site's tools. Ask one useful preference only when no search criterion is supplied. Use get_search_filters only for an unclear enum. For ‘Berlin or remote’, pass locations=['Berlin'] with remoteOrLocations=true. Default headless keeps the page unchanged; use follow only when the person asks to watch. Results include IDs, salary, seniority, evidence, and a cursor.",
    inputSchema: searchJobsToolInputJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = searchJobsToolInput.parse(input);
        const { presentation, ...agentInput } = parsed;
        if (presentation === "headless") {
          const agentResult = await dependencies.searchJobs(agentInput, { signal });
          await dependencies.onHeadlessSearchCommitted?.({
            criteria: { ...agentResult.criteria, cursor: null, limit: visibleSearchPageSize },
            total: agentResult.total,
            presentation: "headless",
          });
          return completedWebMcpResult({
            summary: `Found ${String(agentResult.total)} matching technology role${agentResult.total === 1 ? "" : "s"}.`,
            data: compactSearchResult(agentResult, presentation),
          });
        }
        const visibleInput = { ...agentInput, limit: visibleSearchPageSize };
        delete visibleInput.cursor;
        const [agentResult, visibleResult] = await Promise.all([
          dependencies.searchJobs(agentInput, { signal }),
          dependencies.searchJobs(visibleInput, { signal }),
        ]);
        const parameters = searchInputToSearchParams(visibleInput);
        const href = parameters.size === 0 ? "/jobs" : `/jobs?${parameters.toString()}`;
        await dependencies.onNavigate(href, { signal });
        await dependencies.onSearchCommitted(visibleInput, visibleResult);
        return completedWebMcpResult({
          summary: `Found ${String(agentResult.total)} matching technology role${agentResult.total === 1 ? "" : "s"}.`,
          data: compactSearchResult(agentResult, presentation),
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "The job-search criteria are invalid.");
      }
    },
  };

  const getSearchState: ToolManifest<unknown, SearchToolOutput> = {
    name: "get_search_state",
    purpose: "Read the latest completed search constraints and result count without rerunning it.",
    description:
      "Read the latest headless or visible search. Use detail=summary for a bounded explanation, or detail=exact for criteria accepted by save_job_search and request_search_alert. Returns whether the search is visible and never reruns it.",
    inputSchema: searchStateInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = searchStateInput.parse(input);
        const rawState = dependencies.getSearchState();
        if (rawState === null) {
          return completedWebMcpResult({
            summary: "No completed search is available yet.",
            data: { ready: false },
          });
        }
        const state: SearchWebMcpState =
          "criteria" in rawState
            ? rawState
            : { criteria: normalizeJobSearchCriteria(rawState), total: null };
        const presentation = state.presentation ?? "follow";
        if (parsed.detail === "exact") {
          return completedWebMcpResult({
            summary: "Read the exact search criteria for reuse.",
            data: {
              ready: true,
              total: state.total,
              presentation,
              visible: presentation === "follow",
              criteria: reusableCriteria(state.criteria),
            },
            facts: [{ key: "search_total", value: state.total }],
          });
        }
        return completedWebMcpResult({
          summary: "Read the latest search state.",
          data: {
            ready: true,
            total: state.total,
            presentation,
            visible: presentation === "follow",
            criteria: compactCriteria(state.criteria),
          },
          facts: [{ key: "search_total", value: state.total }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Search state accepts no arguments.");
      }
    },
  };

  const getSearchFilters: ToolManifest<unknown, SearchToolOutput> = {
    name: "get_search_filters",
    purpose: "Read accepted filter values only when the search vocabulary is unclear.",
    description:
      "Read Jobbbler's exact search vocabulary: accepted categories, work models, seniorities, salary options, and sort orders. Use when an enum is unclear, not before every search; search_jobs already documents common values.",
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
            employmentTypes: [...employmentTypeSchema.options],
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
            pagination: {
              pageSize: searchJobsPageSize,
              cursor: "Pass nextCursor back as cursor with every other criterion unchanged.",
            },
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
