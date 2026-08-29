import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  assertSourceFetchAllowed,
  getNextAllowedAt,
  sourcePolicySchema,
  type SourcePolicy,
} from "./policy.js";
import { getBuiltInSourcePolicies } from "./catalog.js";

const policyDirectory = new URL("../source-policies/", import.meta.url);

const basePolicy: SourcePolicy = {
  version: 1,
  sourceKey: "jobicy",
  enabled: true,
  allowedPurposes: ["job_discovery"],
  minimumPollIntervalSeconds: 21_600,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 1_000_000,
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
  notes: "Use a conservative cached poll cadence.",
};

describe("source policy", () => {
  it("validates every checked-in policy and keeps ambiguous Arbeitnow disabled", async () => {
    const policies = await Promise.all(
      ["jobicy", "remoteok", "arbeitnow"].map(async (source) => {
        const path = fileURLToPath(new URL(`${source}.json`, policyDirectory));
        return sourcePolicySchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
      }),
    );

    expect(policies.map(({ sourceKey }) => sourceKey)).toEqual(["jobicy", "remoteok", "arbeitnow"]);
    expect(
      policies.find(({ sourceKey }) => sourceKey === "jobicy")?.minimumPollIntervalSeconds,
    ).toBeGreaterThanOrEqual(3_600);
    expect(policies.find(({ sourceKey }) => sourceKey === "remoteok")?.attribution).toMatchObject({
      required: true,
      followedLinkRequired: true,
    });
    expect(policies.find(({ sourceKey }) => sourceKey === "arbeitnow")).toMatchObject({
      enabled: false,
      commercialUse: "requires_permission",
    });
    expect(getBuiltInSourcePolicies()).toEqual(policies);
  });

  it("blocks disabled, disallowed-purpose, and early fetches", () => {
    expect(() =>
      assertSourceFetchAllowed(
        { ...basePolicy, enabled: false },
        "job_discovery",
        "2026-08-29T12:00:00.000Z",
        null,
      ),
    ).toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() =>
      assertSourceFetchAllowed(
        basePolicy,
        "saved_search_delivery",
        "2026-08-29T12:00:00.000Z",
        null,
      ),
    ).toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() =>
      assertSourceFetchAllowed(
        basePolicy,
        "job_discovery",
        "2026-08-29T12:00:00.000Z",
        "2026-08-29T10:00:00.000Z",
      ),
    ).toThrowError(expect.objectContaining({ code: "RATE_LIMITED", retryable: true }));
  });

  it("rejects a branded connector policy pointed at an unreviewed endpoint", () => {
    expect(() =>
      sourcePolicySchema.parse({
        ...basePolicy,
        sourceUrl: "https://unreviewed.example/api/jobs",
      }),
    ).toThrow();
    expect(() =>
      sourcePolicySchema.parse({
        ...basePolicy,
        termsUrl: "https://unreviewed.example/terms",
      }),
    ).toThrow();
  });

  it("calculates the next allowed fetch instant", () => {
    expect(getNextAllowedAt(basePolicy, "2026-08-29T10:00:00.000Z")).toBe(
      "2026-08-29T16:00:00.000Z",
    );
    expect(() =>
      assertSourceFetchAllowed(
        basePolicy,
        "job_discovery",
        "2026-08-29T16:00:00.000Z",
        "2026-08-29T10:00:00.000Z",
      ),
    ).not.toThrow();
  });
});
