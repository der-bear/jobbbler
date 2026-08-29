import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createArbeitnowConnector } from "./arbeitnow/index.js";
import type {
  FetchPartitionInput,
  FetchPartitionResult,
  JobConnector,
  RawSourceRecord,
} from "./contracts.js";
import { createJobicyConnector } from "./jobicy/index.js";
import { sourcePolicySchema, type SourceKey, type SourcePolicy } from "./policy.js";
import { createRemoteOkConnector } from "./remoteok/index.js";

const fixtureRoot = new URL("../../../fixtures/connectors/", import.meta.url);
const policyRoot = new URL("../source-policies/", import.meta.url);
const fetchedAt = "2026-08-29T10:00:00.000Z";

async function loadJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(url), "utf8")) as unknown;
}

async function loadPolicy(sourceKey: SourceKey): Promise<SourcePolicy> {
  return sourcePolicySchema.parse(await loadJson(new URL(`${sourceKey}.json`, policyRoot)));
}

const input: FetchPartitionInput = {
  partition: "default",
  page: 1,
  limit: 10,
  fetchedAt,
  etag: null,
  lastModified: null,
};

async function collect(
  iterator: AsyncGenerator<RawSourceRecord, FetchPartitionResult, void>,
): Promise<{ records: RawSourceRecord[]; result: FetchPartitionResult }> {
  const records: RawSourceRecord[] = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) return { records, result: next.value };
    records.push(next.value);
  }
}

interface ContractCase {
  readonly sourceKey: SourceKey;
  readonly create: (policy: SourcePolicy, body: unknown) => JobConnector;
  readonly acceptedTitles: readonly string[];
  readonly emptyBody: unknown;
}

const cases: ContractCase[] = [
  {
    sourceKey: "jobicy",
    create: (policy, body) =>
      createJobicyConnector({
        policy,
        fetch: vi.fn(async () => Response.json(body, { headers: { etag: '"jobicy-v1"' } })),
      }),
    acceptedTitles: [
      "Senior Platform Engineer",
      "Application Security Engineer",
      "Product Designer",
    ],
    emptyBody: { apiVersion: "2.0", status: "success", jobCount: 0, jobs: [] },
  },
  {
    sourceKey: "remoteok",
    create: (policy, body) =>
      createRemoteOkConnector({
        policy,
        fetch: vi.fn(async () => Response.json(body, { headers: { etag: '"remoteok-v1"' } })),
      }),
    acceptedTitles: ["Senior Backend Engineer", "Cloud Security Engineer", "Technical Writer"],
    emptyBody: [{ legal: "Please link back to Remote OK and do not use our logo." }],
  },
  {
    sourceKey: "arbeitnow",
    create: (policy, body) =>
      createArbeitnowConnector({
        policy: { ...policy, enabled: true, allowedPurposes: ["evaluation"] },
        fetch: vi.fn(async () => Response.json(body, { headers: { etag: '"arbeitnow-v1"' } })),
      }),
    acceptedTitles: ["Senior Frontend Engineer", "Data Engineer", "Product Analyst"],
    emptyBody: {
      data: [],
      links: {
        first: "https://www.arbeitnow.com/api/job-board-api?page=1",
        last: null,
        prev: null,
        next: null,
      },
      meta: {
        current_page: 1,
        current_page_url: "https://www.arbeitnow.com/api/job-board-api?page=1",
        from: null,
        path: "https://www.arbeitnow.com/api/job-board-api",
        per_page: 100,
        to: null,
        total: 0,
      },
    },
  },
];

describe.each(cases)(
  "$sourceKey connector contract",
  ({ sourceKey, create, acceptedTitles, emptyBody }) => {
    it("yields bounded, attributed raw evidence and normalizes only tech work", async () => {
      const policy = await loadPolicy(sourceKey);
      const body = await loadJson(new URL(`${sourceKey}/page-1.json`, fixtureRoot));
      const connector = create(policy, body);
      const fetched = await collect(connector.fetchPartition(input, new AbortController().signal));

      expect(fetched.records).toHaveLength(4);
      expect(fetched.result).toMatchObject({
        complete: sourceKey !== "arbeitnow",
        notModified: false,
        etag: `"${sourceKey}-v1"`,
      });
      for (const record of fetched.records) {
        expect(record).toMatchObject({
          sourceKey,
          partition: "default",
          fetchedAt,
          policyVersion: 1,
          actionCapability: "external_only",
        });
        expect(record.externalId.length).toBeGreaterThan(0);
        expect(record.rawHash).toMatch(/^[a-f0-9]{64}$/);
        expect(record.originalUrl).toMatch(/^https:\/\//);
        expect(record.retainUntil).toMatch(/^2026-/);
      }

      const normalized = fetched.records.map((record) => connector.normalize(record));
      const accepted = normalized.filter((result) => result.accepted);
      const rejected = normalized.filter((result) => !result.accepted);
      expect(accepted.map(({ job }) => job.title)).toEqual(acceptedTitles);
      expect(rejected).toEqual([
        expect.objectContaining({ accepted: false, reason: "outside_tech_taxonomy" }),
      ]);
      for (const result of accepted) {
        expect(result.job.applyMode).toBe("external");
        expect(result.job.source).toMatchObject({
          key: sourceKey,
          label: policy.attribution.label,
        });
        expect(result.job.summary).not.toMatch(/[<>]|script|onerror|iframe/i);
        expect(result.sourceLink.applyUrl).toMatch(/^https:\/\//);
        expect(result.organization.name.length).toBeGreaterThan(0);
      }
    });

    it("respects the smaller caller limit", async () => {
      const policy = await loadPolicy(sourceKey);
      const body = await loadJson(new URL(`${sourceKey}/page-1.json`, fixtureRoot));
      const connector = create(policy, body);
      const fetched = await collect(
        connector.fetchPartition({ ...input, limit: 2 }, new AbortController().signal),
      );
      expect(fetched.records).toHaveLength(2);
      expect(fetched.result.complete).toBe(false);
    });

    it("recognizes a valid empty terminal feed as complete", async () => {
      const policy = await loadPolicy(sourceKey);
      const connector = create(policy, emptyBody);
      const fetched = await collect(connector.fetchPartition(input, new AbortController().signal));

      expect(fetched.records).toEqual([]);
      expect(fetched.result).toMatchObject({ complete: true, nextPage: null });
    });
  },
);

describe("connector schema drift", () => {
  it.each(["jobicy", "arbeitnow"] as const)(
    "quarantines a structurally drifted %s page",
    async (sourceKey) => {
      const contract = cases.find((item) => item.sourceKey === sourceKey);
      if (contract === undefined) throw new Error("Missing connector contract case.");
      const policy = await loadPolicy(sourceKey);
      const body = await loadJson(new URL(`${sourceKey}/schema-drift.json`, fixtureRoot));
      const connector = contract.create(policy, body);
      await expect(
        collect(connector.fetchPartition(input, new AbortController().signal)),
      ).rejects.toMatchObject({ code: "DEPENDENCY", retryable: false });
    },
  );

  it("retains a malformed Remote OK row as rejected raw evidence", async () => {
    const contract = cases.find((item) => item.sourceKey === "remoteok");
    if (contract === undefined) throw new Error("Missing Remote OK contract case.");
    const policy = await loadPolicy("remoteok");
    const body = await loadJson(new URL("remoteok/schema-drift.json", fixtureRoot));
    const connector = contract.create(policy, body);
    const fetched = await collect(connector.fetchPartition(input, new AbortController().signal));

    expect(fetched.records).toHaveLength(1);
    expect(connector.normalize(fetched.records[0]!)).toMatchObject({
      accepted: false,
      reason: "invalid_record",
    });
  });
});
