import { describe, expect, it, vi } from "vitest";

import {
  compareJobsResultSchema,
  jobDetailResultSchema,
  searchJobsResultSchema,
} from "@jobbbler/contracts";
import type {
  CompareJobsInput,
  CompareJobsResult,
  Job,
  JobDetailInput,
  JobDetailResult,
  JobFit,
  JobSearchCriteria,
  JobSearchInput,
  SearchJobsResult,
} from "@jobbbler/contracts";

import { createCompareToolManifests } from "./compare/webmcp-tools";
import { createJobDetailToolManifests } from "./job-detail/webmcp-tools";
import { createSearchToolManifests } from "./search/webmcp-tools";

const firstJobId = "job_00000001-0000-7000-8000-000000000001";
const secondJobId = "job_00000004-0000-7000-8000-000000000004";
const thirdJobId = "job_00000005-0000-7000-8000-000000000005";

const searchCriteria: JobSearchCriteria = {
  query: "platform",
  categories: [],
  workModels: ["remote"],
  seniorities: [],
  locations: ["Europe"],
  skills: [],
  excludeKeywords: [],
  salary: null,
  postedWithinDays: null,
  sort: "relevance",
  cursor: null,
  limit: 20,
  unresolvedAssumptions: [],
};

const firstJob: Job = {
  id: firstJobId,
  organizationId: "org_00000001-0000-7000-8000-000000000001",
  organizationName: "Northstar Systems",
  title: "Platform Engineer",
  summary: "Build reliable job-search systems.",
  categories: ["software_engineering"],
  workModel: "remote",
  employmentType: "full_time",
  seniority: "senior",
  locations: ["Europe"],
  skills: ["TypeScript", "React"],
  salary: { minimum: 100_000, maximum: 130_000, currency: "EUR", period: "year" },
  source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
  applyMode: "external",
  status: "open",
  publishedAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

const secondJob: Job = {
  ...firstJob,
  id: secondJobId,
  organizationId: "org_00000004-0000-7000-8000-000000000004",
  title: "Principal Platform Engineer",
};

const fit: JobFit = {
  eligible: true,
  score: 88,
  evidence: ["Matches the requested remote work model."],
  caveats: [],
  exclusions: [],
  dimensions: {
    text: { status: "match", score: 1, matched: ["platform"], missing: [] },
    categories: { status: "not_requested", score: 0, matched: [], missing: [] },
    workModel: { status: "match", score: 1, matched: ["remote"], missing: [] },
    seniority: { status: "not_requested", score: 0, matched: [], missing: [] },
    locations: { status: "match", score: 1, matched: ["Europe"], missing: [] },
    skills: { status: "not_requested", score: 0, matched: [], missing: [] },
    salary: { status: "not_requested", score: 0, matched: [], missing: [] },
    freshness: { status: "not_requested", score: 0, matched: [], missing: [] },
  },
};

const searchResult: SearchJobsResult = {
  criteria: searchCriteria,
  jobs: [{ ...firstJob, matchScore: 88, matchEvidence: fit.evidence }],
  total: 1,
  nextCursor: null,
  catalogUpdatedAt: "2026-08-29T00:00:00.000Z",
  warnings: [],
};

const detailResult: JobDetailResult = { job: firstJob, fit };
const comparisonResult: CompareJobsResult = {
  criteria: searchCriteria,
  jobs: [
    { job: firstJob, fit },
    { job: secondJob, fit: { ...fit, score: 84 } },
  ],
};

type ToolOutput = Readonly<{ status: string; [key: string]: unknown }>;
type ToolManifest = Readonly<{
  name: string;
  purpose: string;
  description: string;
  annotations: Readonly<{ readOnlyHint: boolean; untrustedContentHint: boolean }>;
  execute(input: unknown, options: Readonly<{ signal: AbortSignal }>): Promise<ToolOutput>;
}>;

function tool(manifests: readonly ToolManifest[], name: string): ToolManifest {
  const manifest = manifests.find((candidate) => candidate.name === name);
  if (manifest === undefined) throw new Error(`Missing ${name} manifest.`);
  return manifest;
}

function expectAnnotatedUntrustedRoute(
  manifests: readonly ToolManifest[],
  names: string[],
  trustedContentNames: readonly string[] = [],
): void {
  expect(manifests.map(({ name }) => name)).toEqual(names);
  expect(new Set(manifests.map(({ purpose }) => purpose)).size).toBe(manifests.length);
  expect(new Set(manifests.map(({ description }) => description)).size).toBe(manifests.length);
  expect(manifests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        annotations: expect.objectContaining({ untrustedContentHint: true }),
      }),
    ]),
  );
  for (const manifest of manifests) {
    expect(typeof manifest.annotations.readOnlyHint).toBe("boolean");
    expect(manifest.annotations.untrustedContentHint).toBe(
      !trustedContentNames.includes(manifest.name),
    );
  }
}

function expectValidationEnvelope(result: ToolOutput): void {
  expect(result).toMatchObject({
    status: "failed",
    error: { code: "VALIDATION", retryable: false },
  });
}

function expectBoundedJson(result: ToolOutput): void {
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(1_500);
}

async function expectSafeRejection(execution: Promise<ToolOutput>): Promise<void> {
  const result = await execution;
  expectValidationEnvelope(result);
  expectBoundedJson(result);
}

describe("route-scoped WebMCP tool manifests", () => {
  it("creates the search route names from the eval fixture, validates raw input, and commits a successful search", async () => {
    let receivedSignal: AbortSignal | undefined;
    const searchJobs = vi.fn(
      async (
        _input: JobSearchInput,
        options: { readonly signal: AbortSignal },
      ): Promise<SearchJobsResult> => {
        receivedSignal = options.signal;
        return searchJobsResultSchema.parse(searchResult);
      },
    );
    const onSearchCommitted = vi.fn();
    const onNavigate = vi.fn();
    const manifests = createSearchToolManifests({
      searchJobs,
      getSearchState: (): JobSearchInput => ({ query: "platform", sort: "relevance", limit: 20 }),
      onSearchCommitted,
      onNavigate,
    }) as readonly ToolManifest[];

    expectAnnotatedUntrustedRoute(
      manifests,
      ["search_jobs", "get_search_state", "get_search_filters", "open_job_details"],
      ["get_search_filters"],
    );
    expect(manifests.map(({ annotations }) => annotations.readOnlyHint)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(tool(manifests, "search_jobs").description).toContain("Ask for one useful preference");

    const controller = new AbortController();
    const success = await tool(manifests, "search_jobs").execute(
      { query: "platform", limit: 20 },
      { signal: controller.signal },
    );
    expect(receivedSignal).toBe(controller.signal);
    expect(searchJobs).toHaveBeenCalledOnce();
    expect(onSearchCommitted).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining("q=platform"));
    expect(success.status).toBe("completed");
    expectBoundedJson(success);

    await expectSafeRejection(
      tool(manifests, "search_jobs").execute({ query: 42 }, { signal: controller.signal }),
    );
    await expectSafeRejection(
      tool(manifests, "search_jobs").execute(
        { query: "platform", unknownFilter: true },
        { signal: controller.signal },
      ),
    );
    await expectSafeRejection(
      tool(manifests, "search_jobs").execute(
        { query: "platform", cursor: "undocumented-pagination-cursor" },
        { signal: controller.signal },
      ),
    );
  });

  it("reports every compacted search-state field instead of silently dropping criteria", async () => {
    const criteria: JobSearchCriteria = {
      ...searchCriteria,
      query: "Q".repeat(100),
      categories: ["software_engineering", "product", "security"],
      workModels: ["remote", "hybrid", "onsite"],
      seniorities: ["senior", "staff", "principal"],
      locations: ["L".repeat(40), "Europe", "Kyiv"],
      skills: ["TypeScript", "PostgreSQL"],
      excludeKeywords: ["agency", "crypto"],
    };
    const manifests = createSearchToolManifests({
      searchJobs: async () => searchResult,
      getSearchState: () => ({ criteria, total: 7 }),
      onSearchCommitted: () => undefined,
      onNavigate: () => undefined,
    }) as readonly ToolManifest[];

    const output = await tool(manifests, "get_search_state").execute(
      {},
      { signal: new AbortController().signal },
    );

    expect(output).toMatchObject({
      status: "completed",
      data: {
        criteria: {
          truncation: {
            complete: false,
            omitted: {
              categories: 1,
              workModels: 1,
              seniorities: 1,
              locations: 1,
              skills: 1,
              excludeKeywords: 1,
            },
            shortened: ["query", "locations"],
          },
        },
      },
    });
    expectBoundedJson(output);

    const exact = await tool(manifests, "get_search_state").execute(
      { detail: "exact" },
      { signal: new AbortController().signal },
    );
    expect(exact).toMatchObject({
      status: "completed",
      data: {
        ready: true,
        total: 7,
        criteria: {
          query: criteria.query,
          categories: criteria.categories,
          workModels: criteria.workModels,
          seniorities: criteria.seniorities,
          locations: criteria.locations,
          skills: criteria.skills,
          excludeKeywords: criteria.excludeKeywords,
          sort: criteria.sort,
          limit: criteria.limit,
        },
      },
    });
    expect(JSON.stringify(exact)).not.toContain("truncation");
    expect(new TextEncoder().encode(JSON.stringify(exact)).byteLength).toBeLessThanOrEqual(
      64 * 1_024,
    );

    await expectSafeRejection(
      tool(manifests, "get_search_state").execute(
        { detail: "verbose" },
        { signal: new AbortController().signal },
      ),
    );
  });

  it("creates detail route tools, forwards cancellation to typed commands, and synchronizes detail and comparison UI", async () => {
    let detailSignal: AbortSignal | undefined;
    let compareSignal: AbortSignal | undefined;
    const onDetailCommitted = vi.fn();
    const onNavigate = vi.fn();
    const manifests = createJobDetailToolManifests({
      currentJobId: firstJobId,
      getJobDetails: vi.fn(
        async (
          _input: JobDetailInput,
          options: { readonly signal: AbortSignal },
        ): Promise<JobDetailResult> => {
          detailSignal = options.signal;
          return jobDetailResultSchema.parse(detailResult);
        },
      ),
      compareJobs: vi.fn(
        async (
          _input: CompareJobsInput,
          options: { readonly signal: AbortSignal },
        ): Promise<CompareJobsResult> => {
          compareSignal = options.signal;
          return compareJobsResultSchema.parse(comparisonResult);
        },
      ),
      onDetailCommitted,
      onNavigate,
    }) as readonly ToolManifest[];

    expectAnnotatedUntrustedRoute(manifests, [
      "get_job_details",
      "get_job_application_capability",
      "compare_jobs",
    ]);
    expect(manifests.map(({ annotations }) => annotations.readOnlyHint)).toEqual([
      true,
      true,
      false,
    ]);
    expect(tool(manifests, "compare_jobs").description).toContain(
      "after two or three exact job IDs are known",
    );
    expect(tool(manifests, "compare_jobs").description).toContain("Never call it with one role");
    expect(tool(manifests, "get_job_application_capability").description).toContain(
      "call this directly without searching",
    );

    const controller = new AbortController();
    const detail = await tool(manifests, "get_job_details").execute(
      { jobId: firstJobId },
      { signal: controller.signal },
    );
    expect(detailSignal).toBe(controller.signal);
    expect(onDetailCommitted).toHaveBeenCalledOnce();
    expect(detail.status).toBe("completed");
    expectBoundedJson(detail);

    const comparison = await tool(manifests, "compare_jobs").execute(
      { jobIds: [firstJobId, secondJobId] },
      { signal: controller.signal },
    );
    expect(compareSignal).toBe(controller.signal);
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining("/compare"));
    expect(comparison.status).toBe("completed");
    expectBoundedJson(comparison);

    await expectSafeRejection(
      tool(manifests, "get_job_details").execute(
        { jobId: firstJobId, unexpected: true },
        { signal: controller.signal },
      ),
    );
    await expectSafeRejection(
      tool(manifests, "compare_jobs").execute(
        { jobIds: [firstJobId, firstJobId] },
        { signal: controller.signal },
      ),
    );
  });

  it("creates comparison route tools, guards removal to selected IDs, and commits URL state after removal", async () => {
    let removeSignal: AbortSignal | undefined;
    const getComparison = vi.fn(
      async (options: { readonly signal: AbortSignal }): Promise<CompareJobsResult> => {
        expect(options.signal).toBeInstanceOf(AbortSignal);
        return compareJobsResultSchema.parse(comparisonResult);
      },
    );
    const removeJobFromComparison = vi.fn(
      async (_jobId: string, options: { readonly signal: AbortSignal }) => {
        removeSignal = options.signal;
        return { jobIds: [firstJobId] };
      },
    );
    const onComparisonCommitted = vi.fn();
    const onNavigate = vi.fn();
    const manifests = createCompareToolManifests({
      selectedJobIds: [firstJobId, secondJobId],
      getComparison,
      removeJobFromComparison,
      onComparisonCommitted,
      onNavigate,
    }) as readonly ToolManifest[];

    expectAnnotatedUntrustedRoute(manifests, [
      "get_comparison",
      "remove_job_from_comparison",
      "add_job_to_comparison",
    ]);
    expect(manifests.map(({ annotations }) => annotations.readOnlyHint)).toEqual([
      true,
      false,
      false,
    ]);
    expect(tool(manifests, "get_comparison").description).toContain(
      "ask for the person's ranking criteria",
    );

    const controller = new AbortController();
    const comparison = await tool(manifests, "get_comparison").execute(
      {},
      { signal: controller.signal },
    );
    expect(getComparison).toHaveBeenCalledWith({ signal: controller.signal });
    expect(comparison.status).toBe("completed");
    expectBoundedJson(comparison);

    const removed = await tool(manifests, "remove_job_from_comparison").execute(
      { jobId: secondJobId },
      { signal: controller.signal },
    );
    expect(removeSignal).toBe(controller.signal);
    expect(onComparisonCommitted).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining("/compare"));
    expect(removed.status).toBe("completed");
    expectBoundedJson(removed);

    await expectSafeRejection(
      tool(manifests, "remove_job_from_comparison").execute(
        { jobId: "job_0000000d-0000-7000-8000-00000000000d" },
        { signal: controller.signal },
      ),
    );
    expect(removeJobFromComparison).toHaveBeenCalledOnce();
  });

  it("reads an explicitly identified role without requiring its page to be open", async () => {
    const getJobDetails = vi.fn(async (): Promise<JobDetailResult> => ({
      job: secondJob,
      fit,
    }));
    const manifests = createJobDetailToolManifests({
      getJobDetails,
      compareJobs: async () => comparisonResult,
      onDetailCommitted: () => undefined,
      onNavigate: () => undefined,
    }) as readonly ToolManifest[];

    const result = await tool(manifests, "get_job_details").execute(
      { jobId: secondJobId },
      { signal: new AbortController().signal },
    );

    expect(result.status).toBe("completed");
    expect(getJobDetails).toHaveBeenCalledWith(
      { jobId: secondJobId },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps successful outputs inside the browser budget at contract field maxima", async () => {
    const longestJob: Job = {
      ...firstJob,
      title: "T".repeat(180),
      organizationName: "O".repeat(160),
      summary: "S".repeat(2_000),
      locations: Array.from({ length: 8 }, (_, index) => `${String(index)}${"L".repeat(118)}`),
      skills: Array.from({ length: 30 }, (_, index) => `${String(index)}${"K".repeat(77)}`),
      source: { ...firstJob.source, label: "P".repeat(80) },
    };
    const longestFit: JobFit = {
      ...fit,
      evidence: Array.from({ length: 12 }, () => "E".repeat(240)),
      caveats: Array.from({ length: 12 }, () => "C".repeat(240)),
    };
    const longestCriteria: JobSearchCriteria = {
      ...searchCriteria,
      query: "Q".repeat(500),
      locations: Array.from({ length: 12 }, (_, index) => `${String(index)}${"L".repeat(118)}`),
      skills: Array.from({ length: 20 }, (_, index) => `${String(index)}${"K".repeat(118)}`),
      excludeKeywords: Array.from(
        { length: 20 },
        (_, index) => `${String(index)}${"X".repeat(118)}`,
      ),
      unresolvedAssumptions: Array.from({ length: 12 }, () => "A".repeat(240)),
    };
    const maximalSearch: SearchJobsResult = {
      ...searchResult,
      criteria: longestCriteria,
      jobs: [
        { ...longestJob, matchScore: 88 },
        { ...longestJob, id: secondJobId, matchScore: 84 },
      ],
      total: 50,
    };
    const maximalDetail: JobDetailResult = { job: longestJob, fit: longestFit };
    const maximalComparison: CompareJobsResult = {
      criteria: longestCriteria,
      jobs: [
        { job: longestJob, fit: longestFit },
        { job: { ...longestJob, id: secondJobId }, fit: longestFit },
        { job: { ...longestJob, id: thirdJobId }, fit: longestFit },
      ],
    };
    const controller = new AbortController();

    const searchTools = createSearchToolManifests({
      searchJobs: async () => maximalSearch,
      getSearchState: () => ({ criteria: longestCriteria, total: 50 }),
      onSearchCommitted: () => undefined,
      onNavigate: () => undefined,
    }) as readonly ToolManifest[];
    const searchOutput = await tool(searchTools, "search_jobs").execute(
      { query: "platform" },
      { signal: controller.signal },
    );
    const searchStateOutput = await tool(searchTools, "get_search_state").execute(
      {},
      { signal: controller.signal },
    );

    const detailTools = createJobDetailToolManifests({
      currentJobId: firstJobId,
      getJobDetails: async () => maximalDetail,
      compareJobs: async () => maximalComparison,
      onDetailCommitted: () => undefined,
      onNavigate: () => undefined,
    }) as readonly ToolManifest[];
    const detailOutput = await tool(detailTools, "get_job_details").execute(
      { jobId: firstJobId },
      { signal: controller.signal },
    );
    const detailComparisonOutput = await tool(detailTools, "compare_jobs").execute(
      { jobIds: [firstJobId, secondJobId, thirdJobId] },
      { signal: controller.signal },
    );

    const compareTools = createCompareToolManifests({
      selectedJobIds: [firstJobId, secondJobId, thirdJobId],
      getComparison: async () => maximalComparison,
      removeJobFromComparison: async () => ({ jobIds: [firstJobId, secondJobId] }),
      onComparisonCommitted: () => undefined,
      onNavigate: () => undefined,
    }) as readonly ToolManifest[];
    const compareOutput = await tool(compareTools, "get_comparison").execute(
      {},
      { signal: controller.signal },
    );

    const outputs = [
      searchOutput,
      searchStateOutput,
      detailOutput,
      detailComparisonOutput,
      compareOutput,
    ];
    expect(outputs.map(({ status }) => status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    for (const output of outputs) {
      expectBoundedJson(output);
    }
  });
});
