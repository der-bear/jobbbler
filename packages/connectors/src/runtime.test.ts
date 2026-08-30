import { describe, expect, it, vi } from "vitest";

import type { SourcePolicy } from "./policy.js";
import { fetchBoundedJson } from "./runtime.js";

const policy: SourcePolicy = {
  version: 1,
  sourceKey: "jobicy",
  enabled: true,
  allowedPurposes: ["job_discovery"],
  minimumPollIntervalSeconds: 21_600,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 100,
  maxRecords: 50,
  rawPayloadRetentionDays: 7,
  redistribution: "attributed_excerpt",
  commercialUse: "allowed_with_attribution",
  attribution: {
    label: "Jobicy",
    url: "https://jobicy.com/",
    required: true,
    followedLinkRequired: false,
  },
  sourceUrl: "https://jobicy.com/api/v2/remote-jobs",
  termsUrl: "https://jobicy.com/jobs-rss-feed",
  userAgent: "Jobbbler/0.1 (+https://jobbbler.example/about/sources)",
  notes: "Test policy.",
};

describe("fetchBoundedJson", () => {
  it("sends descriptive and conditional headers and handles 304", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      const headers = new Headers(init?.headers);
      expect(headers.get("user-agent")).toBe(policy.userAgent);
      expect(headers.get("if-none-match")).toBe('"v1"');
      expect(headers.get("if-modified-since")).toBe("Fri, 28 Aug 2026 10:00:00 GMT");
      return new Response(null, { status: 304, headers: { etag: '"v1"' } });
    });

    await expect(
      fetchBoundedJson(policy.sourceUrl, {
        policy,
        fetch,
        signal: new AbortController().signal,
        etag: '"v1"',
        lastModified: "Fri, 28 Aug 2026 10:00:00 GMT",
      }),
    ).resolves.toEqual({
      notModified: true,
      body: null,
      etag: '"v1"',
      lastModified: null,
      bytes: 0,
    });
  });

  it("refuses provider redirects instead of following them to an untrusted destination", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
    );

    await expect(
      fetchBoundedJson(policy.sourceUrl, {
        policy,
        fetch,
        signal: new AbortController().signal,
        etag: null,
        lastModified: null,
      }),
    ).rejects.toMatchObject({
      code: "DEPENDENCY",
      retryable: false,
      message: "Source redirects are not allowed.",
    });
  });

  it("rejects a declared or streamed response larger than policy", async () => {
    const declaredFetch = vi.fn(
      async () => new Response("{}", { status: 200, headers: { "content-length": "101" } }),
    );
    await expect(
      fetchBoundedJson(policy.sourceUrl, {
        policy,
        fetch: declaredFetch,
        signal: new AbortController().signal,
        etag: null,
        lastModified: null,
      }),
    ).rejects.toMatchObject({ code: "DEPENDENCY", retryable: false });

    const streamedFetch = vi.fn(
      async () => new Response(JSON.stringify({ value: "x".repeat(200) })),
    );
    await expect(
      fetchBoundedJson(policy.sourceUrl, {
        policy,
        fetch: streamedFetch,
        signal: new AbortController().signal,
        etag: null,
        lastModified: null,
      }),
    ).rejects.toMatchObject({ code: "DEPENDENCY", retryable: false });
  });

  it("propagates caller cancellation as a typed cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Cancelled", "AbortError"));
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      throw init?.signal?.reason;
    });

    await expect(
      fetchBoundedJson(policy.sourceUrl, {
        policy,
        fetch,
        signal: controller.signal,
        etag: null,
        lastModified: null,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED", retryable: false });
  });
});
