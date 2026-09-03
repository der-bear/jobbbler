import { describe, expect, it, vi } from "vitest";

import { compareJobsResultSchema, jobDetailResultSchema } from "@jobbbler/contracts";
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

import { createWebMcpNavigator } from "@/lib/webmcp-navigation";
import {
  commitWebMcpSearch,
  publishSearchSurfaceState,
  readSearchSurfaceState,
} from "@/lib/webmcp-ui-bridge";

import { createCompareToolManifests } from "./compare/webmcp-tools";
import { createJobDetailToolManifests } from "./job-detail/webmcp-tools";
import { createSearchToolManifests } from "./search/webmcp-tools";

const firstJobId = "job_00000001-0000-7000-8000-000000000001";
const secondJobId = "job_00000004-0000-7000-8000-000000000004";
const thirdJobId = "job_00000005-0000-7000-8000-000000000005";
const fourthJobId = "job_00000006-0000-7000-8000-000000000006";

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
  locations: ["Berlin, Germany", "Germany", "Europe"],
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

const thirdJob: Job = {
  ...firstJob,
  id: thirdJobId,
  organizationId: "org_00000005-0000-7000-8000-000000000005",
  title: "Staff Reliability Engineer",
};

const fourthJob: Job = {
  ...firstJob,
  id: fourthJobId,
  organizationId: "org_00000006-0000-7000-8000-000000000006",
  title: "Senior Infrastructure Engineer",
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
  inputSchema: unknown;
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

function expectBoundedJson(result: ToolOutput, maximumBytes = 1_500): void {
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
    maximumBytes,
  );
}

async function expectSafeRejection(execution: Promise<ToolOutput>): Promise<void> {
  const result = await execution;
  expectValidationEnvelope(result);
  expectBoundedJson(result);
}

describe("route-scoped WebMCP tool manifests", () => {
  it("keeps agent retrieval separate from the visible top-twenty search in follow mode", async () => {
    const agentResult: SearchJobsResult = {
      ...searchResult,
      criteria: { ...searchResult.criteria, query: "platform", cursor: null, limit: 3 },
      jobs: [
        {
          ...firstJob,
          locations: ["Europe", "Berlin, Germany"],
          matchScore: 88,
          matchEvidence: fit.evidence,
        },
      ],
      total: 4,
      nextCursor: "cursor-3",
    };
    const visibleResult: SearchJobsResult = {
      ...searchResult,
      criteria: { ...searchResult.criteria, query: "platform", cursor: null, limit: 20 },
      jobs: [firstJob, secondJob, thirdJob, fourthJob],
      total: 4,
    };
    const pendingSearches: Array<
      Readonly<{
        input: JobSearchInput;
        signal: AbortSignal;
        resolve: (result: SearchJobsResult) => void;
      }>
    > = [];
    const searchJobs = vi.fn(
      (
        input: JobSearchInput,
        options: { readonly signal: AbortSignal },
      ): Promise<SearchJobsResult> =>
        new Promise((resolve) => {
          pendingSearches.push({ input, signal: options.signal, resolve });
        }),
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
    expect(tool(manifests, "search_jobs").description).toContain("Ask one useful preference");
    expect(tool(manifests, "search_jobs").description).toContain("Default headless");
    expect(JSON.stringify(tool(manifests, "search_jobs").inputSchema)).toContain(
      "for remote-only, use workModels=['remote'].",
    );

    const controller = new AbortController();
    const execution = tool(manifests, "search_jobs").execute(
      { query: "platform", limit: 3, presentation: "follow" },
      { signal: controller.signal },
    );
    expect(searchJobs).toHaveBeenCalledTimes(2);
    expect(pendingSearches.map(({ signal }) => signal)).toEqual([
      controller.signal,
      controller.signal,
    ]);
    expect(searchJobs.mock.calls.map(([input]) => input)).toEqual([
      { query: "platform", sort: "relevance", limit: 3 },
      { query: "platform", sort: "relevance", limit: 20 },
    ]);
    pendingSearches[0]?.resolve(agentResult);
    pendingSearches[1]?.resolve(visibleResult);
    const success = await execution;
    expect(onSearchCommitted).toHaveBeenCalledWith(
      { query: "platform", sort: "relevance", limit: 20 },
      visibleResult,
    );
    expect(onNavigate).toHaveBeenCalledWith("/jobs?q=platform", {
      signal: controller.signal,
    });
    expect(success).toMatchObject({
      status: "completed",
      data: {
        presentation: "follow",
        jobs: [
          {
            location: "Berlin, Germany",
            seniority: "senior",
            salaryMaximum: 130_000,
            salaryPeriod: "year",
            matchEvidence: ["Matches the requested remote work model."],
          },
        ],
        nextCursor: "cursor-3",
      },
    });
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
        { query: "platform", limit: 20 },
        { signal: controller.signal },
      ),
    );
    expect(searchJobs).toHaveBeenCalledTimes(2);
  });

  it("searches headlessly by default without navigation or duplicate retrieval", async () => {
    const headlessResult: SearchJobsResult = {
      ...searchResult,
      criteria: { ...searchResult.criteria, query: "platform", cursor: null, limit: 3 },
      total: 4,
      nextCursor: "cursor-3",
    };
    const searchJobs = vi.fn(async () => headlessResult);
    const onSearchCommitted = vi.fn();
    const onHeadlessSearchCommitted = vi.fn();
    const onNavigate = vi.fn();
    const signal = new AbortController().signal;
    const manifests = createSearchToolManifests({
      searchJobs,
      getSearchState: () => null,
      onSearchCommitted,
      onHeadlessSearchCommitted,
      onNavigate,
    }) as readonly ToolManifest[];

    const result = await tool(manifests, "search_jobs").execute({ query: "platform" }, { signal });

    expect(searchJobs).toHaveBeenCalledOnce();
    expect(searchJobs).toHaveBeenCalledWith(
      { query: "platform", sort: "relevance", limit: 3 },
      { signal },
    );
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onSearchCommitted).not.toHaveBeenCalled();
    expect(onHeadlessSearchCommitted).toHaveBeenCalledWith({
      criteria: { ...headlessResult.criteria, cursor: null, limit: 20 },
      total: 4,
      presentation: "headless",
    });
    expect(result).toMatchObject({
      status: "completed",
      data: { presentation: "headless", total: 4, nextCursor: "cursor-3" },
    });
    expectBoundedJson(result);
  });

  it("describes headless search state without claiming it is visible", async () => {
    const manifests = createSearchToolManifests({
      searchJobs: async () => searchResult,
      getSearchState: () => ({ criteria: searchCriteria, total: 4, presentation: "headless" }),
      onSearchCommitted: () => undefined,
      onNavigate: () => undefined,
    }) as readonly ToolManifest[];

    const result = await tool(manifests, "get_search_state").execute(
      { detail: "exact" },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      summary: "Read the exact search criteria for reuse.",
      data: { presentation: "headless", visible: false },
      facts: [{ key: "search_total", value: 4 }],
    });
    expect(JSON.stringify(result)).not.toContain("visible_total");
  });

  it("publishes the complete search vocabulary and exact cursor protocol", async () => {
    const manifests = createSearchToolManifests({
      searchJobs: async () => searchResult,
      getSearchState: () => null,
      onSearchCommitted: () => undefined,
      onNavigate: () => undefined,
    }) as readonly ToolManifest[];

    expect(tool(manifests, "search_jobs").inputSchema).toMatchObject({
      properties: {
        employmentTypes: {
          items: {
            enum: ["full_time", "part_time", "contract", "freelance", "internship"],
          },
        },
        sort: {
          enum: ["relevance", "newest", "updated_desc", "salary_desc", "salary_asc"],
        },
        cursor: { type: "string" },
        limit: { minimum: 3, maximum: 3, default: 3 },
        presentation: { enum: ["headless", "follow"], default: "headless" },
      },
    });

    const filters = await tool(manifests, "get_search_filters").execute(
      {},
      { signal: new AbortController().signal },
    );
    expect(filters).toMatchObject({
      status: "completed",
      data: {
        employmentTypes: ["full_time", "part_time", "contract", "freelance", "internship"],
        sort: ["relevance", "newest", "updated_desc", "salary_desc", "salary_asc"],
        pagination: { pageSize: 3 },
      },
    });
    expectBoundedJson(filters);
  });

  it("guides the agent after a literal location search returns no matches", async () => {
    const noMatches: SearchJobsResult = {
      ...searchResult,
      criteria: { ...searchResult.criteria, locations: ["Nowhere City"] },
      jobs: [],
      total: 0,
      nextCursor: null,
    };
    const manifests = createSearchToolManifests({
      searchJobs: async () => noMatches,
      getSearchState: () => null,
      onSearchCommitted: () => undefined,
      onNavigate: () => undefined,
    }) as readonly ToolManifest[];

    const result = await tool(manifests, "search_jobs").execute(
      { locations: ["Nowhere City"] },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        total: 0,
        locationGuidance: expect.stringContaining("check its spelling"),
      },
    });
  });

  it("returns three exact job IDs and an opaque continuation cursor within the agent budget", async () => {
    const nextCursor = "cursor_" + "x".repeat(249);
    const fullRoleTitle = "Senior Infrastructure Engineer, Multi-Tenant Isolation";
    const pagedSearch: SearchJobsResult = {
      ...searchResult,
      criteria: { ...searchResult.criteria, limit: 3 },
      jobs: [
        { ...firstJob, title: fullRoleTitle, matchScore: 88, matchEvidence: fit.evidence },
        { ...secondJob, matchScore: 84, matchEvidence: fit.evidence },
        { ...thirdJob, matchScore: 80, matchEvidence: fit.evidence },
      ],
      total: 50,
      nextCursor,
    };
    const manifests = createSearchToolManifests({
      searchJobs: async () => pagedSearch,
      getSearchState: () => null,
      onSearchCommitted: () => undefined,
      onNavigate: () => undefined,
    }) as readonly ToolManifest[];

    const result = await tool(manifests, "search_jobs").execute(
      { query: "platform", limit: 3 },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        jobs: [{ id: firstJobId, title: fullRoleTitle }, { id: secondJobId }, { id: thirdJobId }],
        nextCursor,
      },
    });
    expectBoundedJson(result);
  });

  it("keeps every backend match reachable across its three-result pages", async () => {
    const jobs = [firstJob, secondJob, thirdJob, fourthJob].map((job, index) => ({
      ...job,
      matchScore: 88 - index * 4,
      matchEvidence: fit.evidence,
    }));
    const backendInputs: JobSearchInput[] = [];
    const visibleHrefs: string[] = [];
    const commits: Array<Readonly<{ input: JobSearchInput; result: SearchJobsResult }>> = [];
    const manifests = createSearchToolManifests({
      async searchJobs(input) {
        backendInputs.push(input);
        const limit = input.limit ?? 20;
        const offset = input.cursor === undefined ? 0 : Number(input.cursor.replace("cursor-", ""));
        const page = jobs.slice(offset, offset + limit);
        const nextOffset = offset + page.length;
        return {
          ...searchResult,
          criteria: {
            ...searchCriteria,
            query: input.query ?? null,
            cursor: input.cursor ?? null,
            limit,
          },
          jobs: page,
          total: jobs.length,
          nextCursor: nextOffset < jobs.length ? `cursor-${String(nextOffset)}` : null,
        };
      },
      getSearchState: () => null,
      onSearchCommitted(input, result) {
        commits.push({ input, result });
      },
      onNavigate(href) {
        visibleHrefs.push(href);
      },
    }) as readonly ToolManifest[];
    const controller = new AbortController();
    expect(tool(manifests, "search_jobs").inputSchema).toMatchObject({
      properties: { limit: { minimum: 3, maximum: 3, default: 3 } },
    });

    const firstPage = await tool(manifests, "search_jobs").execute(
      { query: "platform", presentation: "follow" },
      { signal: controller.signal },
    );
    expect(firstPage).toMatchObject({
      status: "completed",
      data: {
        jobs: [{ id: firstJobId }, { id: secondJobId }, { id: thirdJobId }],
        nextCursor: "cursor-3",
        hasMore: true,
      },
    });
    expectBoundedJson(firstPage);
    expect(backendInputs).toEqual([
      { query: "platform", sort: "relevance", limit: 3 },
      { query: "platform", sort: "relevance", limit: 20 },
    ]);
    expect(visibleHrefs).toEqual(["/jobs?q=platform"]);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.input).toEqual({ query: "platform", sort: "relevance", limit: 20 });
    expect(commits[0]?.result.jobs.map(({ id }) => id)).toEqual([
      firstJobId,
      secondJobId,
      thirdJobId,
      fourthJobId,
    ]);

    const secondPage = await tool(manifests, "search_jobs").execute(
      { query: "platform", cursor: "cursor-3", presentation: "follow" },
      { signal: controller.signal },
    );
    expect(secondPage).toMatchObject({
      status: "completed",
      data: { jobs: [{ id: fourthJobId }], nextCursor: null, hasMore: false },
    });
    expectBoundedJson(secondPage);
    expect(backendInputs.slice(2)).toEqual([
      { query: "platform", sort: "relevance", cursor: "cursor-3", limit: 3 },
      { query: "platform", sort: "relevance", limit: 20 },
    ]);
    expect(visibleHrefs).toEqual(["/jobs?q=platform", "/jobs?q=platform"]);
    expect(commits).toHaveLength(2);
    expect(commits[1]?.input).toEqual({ query: "platform", sort: "relevance", limit: 20 });
    expect(commits[1]?.result.jobs.map(({ id }) => id)).toEqual([
      firstJobId,
      secondJobId,
      thirdJobId,
      fourthJobId,
    ]);
  });

  it("commits navigation and search state before an immediate follow-up reads it", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: new EventTarget(),
    });
    publishSearchSurfaceState(null);
    let currentUrl = "https://jobbbler.test/about/webmcp";
    let destinationUrl = currentUrl;
    const navigate = createWebMcpNavigator({
      currentUrl: () => currentUrl,
      navigate(href) {
        destinationUrl = new URL(href, currentUrl).href;
      },
      pollIntervalMilliseconds: 1,
      timeoutMilliseconds: 1_000,
    });
    const manifests = createSearchToolManifests({
      searchJobs: async (input) => ({
        ...searchResult,
        criteria: {
          ...searchResult.criteria,
          query: input.query ?? null,
          workModels: input.workModels ?? [],
          cursor: input.cursor ?? null,
          limit: input.limit ?? 20,
        },
      }),
      getSearchState: readSearchSurfaceState,
      onSearchCommitted: commitWebMcpSearch,
      onNavigate: navigate,
    }) as readonly ToolManifest[];

    try {
      let settled = false;
      const execution = tool(manifests, "search_jobs")
        .execute(
          { query: "platform", workModels: ["remote"], presentation: "follow" },
          { signal: new AbortController().signal },
        )
        .then((result) => {
          settled = true;
          return result;
        });

      await vi.waitFor(() => {
        expect(destinationUrl).not.toBe(currentUrl);
      });
      expect(settled).toBe(false);
      expect(readSearchSurfaceState()).toBeNull();
      currentUrl = destinationUrl;
      const search = await execution;
      expect(search).toMatchObject({ status: "completed" });
      expect(readSearchSurfaceState()).not.toBeNull();

      const immediateState = await tool(manifests, "get_search_state").execute(
        { detail: "exact" },
        { signal: new AbortController().signal },
      );
      expect(immediateState).toMatchObject({
        status: "completed",
        data: {
          ready: true,
          criteria: { query: "platform", workModels: ["remote"], limit: 20 },
        },
      });
    } finally {
      publishSearchSurfaceState(null);
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else Object.defineProperty(globalThis, "window", originalWindow);
    }
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
    expectBoundedJson(exact);

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

    expectAnnotatedUntrustedRoute(manifests, ["get_job_details", "compare_jobs"]);
    expect(manifests.map(({ annotations }) => annotations.readOnlyHint)).toEqual([true, false]);
    expect(tool(manifests, "get_job_details").description).toContain("jobId");
    expect(tool(manifests, "compare_jobs").description).toContain(
      "after two or three exact job IDs are known",
    );
    expect(tool(manifests, "compare_jobs").description).toContain("jobIds");
    expect(tool(manifests, "compare_jobs").description).toContain("Never call it with one role");
    expect(manifests.map(({ name }) => name)).not.toContain("get_job_application_capability");

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
      { jobIds: [firstJobId, secondJobId], presentation: "follow" },
      { signal: controller.signal },
    );
    expect(compareSignal).toBe(controller.signal);
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining("/compare"), {
      signal: controller.signal,
    });
    expect(comparison.status).toBe("completed");
    expect(comparison).toMatchObject({
      data: {
        jobs: [{ location: "Berlin, Germany" }, { location: "Berlin, Germany" }],
      },
    });
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

  it("compares headlessly by default and follows only when requested", async () => {
    const compareJobs = vi.fn(async () => comparisonResult);
    const onNavigate = vi.fn();
    const manifests = createJobDetailToolManifests({
      getJobDetails: async () => detailResult,
      compareJobs,
      onDetailCommitted: () => undefined,
      onNavigate,
      getCriteriaSearch: () => "q=platform",
    }) as readonly ToolManifest[];
    const signal = new AbortController().signal;

    const headless = await tool(manifests, "compare_jobs").execute(
      { jobIds: [firstJobId, secondJobId] },
      { signal },
    );
    expect(headless).toMatchObject({
      status: "completed",
      data: { presentation: "headless" },
    });
    expect(onNavigate).not.toHaveBeenCalled();

    const followed = await tool(manifests, "compare_jobs").execute(
      { jobIds: [firstJobId, secondJobId], presentation: "follow" },
      { signal },
    );
    expect(followed).toMatchObject({
      status: "completed",
      data: { presentation: "follow" },
    });
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("creates comparison route tools, guards removal to selected IDs, and commits URL state after removal", async () => {
    let removeSignal: AbortSignal | undefined;
    const getComparison = vi.fn(
      async (options: { readonly signal: AbortSignal }): Promise<CompareJobsResult> => {
        expect(options.signal).toBeInstanceOf(AbortSignal);
        return compareJobsResultSchema.parse({
          ...comparisonResult,
          jobs: comparisonResult.jobs.map((entry) => ({
            ...entry,
            job: { ...entry.job, locations: ["Europe", "Berlin, Germany"] },
          })),
        });
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
    expect(comparison).toMatchObject({
      data: {
        jobs: [{ location: "Berlin, Germany" }, { location: "Berlin, Germany" }],
      },
    });
    expectBoundedJson(comparison);

    const removed = await tool(manifests, "remove_job_from_comparison").execute(
      { jobId: secondJobId },
      { signal: controller.signal },
    );
    expect(removeSignal).toBe(controller.signal);
    expect(onComparisonCommitted).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining("/compare"), {
      signal: controller.signal,
    });
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
    const completeSummary = [
      "Why this role exists. The team is replacing a fragile deployment path with a safer platform.",
      "What you will do. Own the migration, pair with maintainers, and document the operating model.",
      "What you bring. Deep TypeScript experience is required; PostgreSQL experience is preferred.",
    ].join("\n\n");
    const completeJob = {
      ...secondJob,
      summary: completeSummary,
      locations: ["Berlin, Germany", "Hamburg, Germany", "Germany", "Europe"],
      skills: ["TypeScript", "React", "PostgreSQL", "Kubernetes"],
    };
    const completeFit = {
      ...fit,
      evidence: [
        "The role title matches platform engineering.",
        "The work model is remote.",
        "The requested region is supported.",
      ],
    };
    const getJobDetails = vi.fn(async (): Promise<JobDetailResult> => ({
      job: completeJob,
      fit: completeFit,
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
    expect(result).toMatchObject({
      data: {
        title: completeJob.title,
        organization: completeJob.organizationName,
        summary: completeSummary,
        locations: ["Berlin, Germany", "Hamburg, Germany"],
        skills: completeJob.skills,
        evidence: completeFit.evidence,
      },
    });
    expectBoundedJson(result, 20_000);
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
      summary: "S".repeat(6_000),
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
        { ...longestJob, id: thirdJobId, matchScore: 80 },
      ],
      total: 50,
      nextCursor: "cursor_" + "x".repeat(249),
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
    expectBoundedJson(searchOutput);
    expectBoundedJson(searchStateOutput);
    expectBoundedJson(detailOutput, 20_000);
    expectBoundedJson(detailComparisonOutput);
    expectBoundedJson(compareOutput);
  });
});
