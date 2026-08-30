import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  clientAddress: "203.0.113.10",
  rateLimitKeys: [] as string[],
  cacheEntries: new Map<string, Promise<unknown>>(),
  cacheRevalidateSeconds: null as number | null,
  searchCalls: 0,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(
    async () =>
      new Headers({
        "x-forwarded-for": runtime.clientAddress,
      }),
  ),
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    <TArguments extends readonly unknown[], TResult>(
      operation: (...arguments_: TArguments) => Promise<TResult>,
      _keyParts: readonly string[],
      options: { readonly revalidate?: number },
    ) =>
    (...arguments_: TArguments): Promise<TResult> => {
      runtime.cacheRevalidateSeconds = options.revalidate ?? null;
      const key = JSON.stringify(arguments_);
      const existing = runtime.cacheEntries.get(key) as Promise<TResult> | undefined;
      if (existing !== undefined) return existing;
      const pending = operation(...arguments_);
      runtime.cacheEntries.set(key, pending);
      return pending;
    },
}));

vi.mock("@/server/commands", () => ({
  getDiscoveryRouteDependencies: () => ({
    commands: {
      searchJobs: {
        execute: vi.fn(async (_context: unknown, input: { readonly query?: string }) => {
          runtime.searchCalls += 1;
          return {
            criteria: {
              query: input.query ?? null,
              categories: [],
              workModels: [],
              seniorities: [],
              locations: [],
              skills: [],
              excludeKeywords: [],
              salary: null,
              postedWithinDays: null,
              sort: input.query === undefined ? "newest" : "relevance",
              cursor: null,
              limit: 20,
              unresolvedAssumptions: [],
            },
            jobs: [],
            total: 0,
            nextCursor: null,
            catalogUpdatedAt: null,
            warnings: [],
          };
        }),
      },
      getJob: { execute: vi.fn() },
      compareJobs: { execute: vi.fn() },
    },
    jobs: { suggestLocations: vi.fn(async () => []) },
    rateLimiter: {
      check: vi.fn(async ({ key }: { readonly key: string }) => {
        runtime.rateLimitKeys.push(key);
        return {
          allowed: true,
          remaining: 59,
          retryAfterSeconds: 0,
          resetAtMs: 61_000,
        };
      }),
    },
    nowMs: () => 1_000,
  }),
}));

import HomePage from "./page";
import JobsPage from "./jobs/page";

beforeEach(() => {
  vi.stubEnv("TRUST_PROXY_HEADERS", "true");
  runtime.rateLimitKeys.length = 0;
  runtime.cacheEntries.clear();
  runtime.cacheRevalidateSeconds = null;
  runtime.searchCalls = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("server-rendered search pages", () => {
  it("passes each page request's client headers into the public search policy", async () => {
    const home = await HomePage({ searchParams: Promise.resolve({ q: "platform" }) });
    runtime.clientAddress = "203.0.113.11";
    const catalog = await JobsPage({ searchParams: Promise.resolve({ q: "platform" }) });

    expect(home.props.initialSearch.result).toMatchObject({ total: 0 });
    expect(catalog.props.initialSearch.result).toMatchObject({ total: 0 });
    expect(runtime.rateLimitKeys).toHaveLength(2);
    expect(runtime.rateLimitKeys[0]).not.toBe(runtime.rateLimitKeys[1]);
    expect(runtime.searchCalls).toBe(1);
    expect(runtime.cacheRevalidateSeconds).toBe(60);
  });
});
