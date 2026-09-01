import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createArbeitnowConnector,
  createJobicyConnector,
  createRemoteOkConnector,
  sourcePolicySchema,
  type SourcePolicy,
} from "@jobbbler/connectors";
import { createSqliteStorage } from "@jobbbler/storage-sqlite";

import { runConnectorBatch, runConnectorIngestion } from "./ingest.js";

const fixtureRoot = new URL("../../../fixtures/connectors/", import.meta.url);
const policyRoot = new URL("../../../packages/connectors/source-policies/", import.meta.url);
const temporaryDirectories: string[] = [];

async function loadJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(url), "utf8")) as unknown;
}

async function loadPolicy(sourceKey: "jobicy" | "remoteok" | "arbeitnow"): Promise<SourcePolicy> {
  return sourcePolicySchema.parse(await loadJson(new URL(`${sourceKey}.json`, policyRoot)));
}

async function loadEnabledPolicy(sourceKey: "jobicy" | "remoteok"): Promise<SourcePolicy> {
  return sourcePolicySchema.parse({ ...(await loadPolicy(sourceKey)), enabled: true });
}

describe("connector ingestion orchestration", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function createStorage() {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-worker-ingest-"));
    temporaryDirectories.push(directory);
    return createSqliteStorage(join(directory, "jobbbler.sqlite"));
  }

  it("persists a bounded source run and makes a later replay idempotent", async () => {
    const storage = await createStorage();
    const policy = await loadEnabledPolicy("jobicy");
    const body = await loadJson(new URL("jobicy/page-1.json", fixtureRoot));
    const fetch = vi.fn(async () => Response.json(body, { headers: { etag: '"jobicy-v1"' } }));
    const connector = createJobicyConnector({ policy, fetch });
    const events: string[] = [];

    const first = await runConnectorIngestion({
      connector,
      storage,
      purpose: "job_discovery",
      now: "2026-08-29T10:00:00.000Z",
      limit: 10,
      runId: "run_jobicy_1",
      signal: new AbortController().signal,
      onEvent: (event) => {
        events.push(event.type);
      },
    });
    expect(first).toMatchObject({
      status: "succeeded",
      recordsFetched: 4,
      recordsAccepted: 3,
      recordsRejected: 1,
      recordsUnchanged: 0,
    });
    expect(await storage.jobs.listAll()).toHaveLength(3);
    expect(events).toEqual([
      "run_started",
      "record_accepted",
      "record_accepted",
      "record_accepted",
      "record_rejected",
      "run_completed",
    ]);

    const replay = await runConnectorIngestion({
      connector,
      storage,
      purpose: "job_discovery",
      now: "2026-08-29T16:00:00.000Z",
      limit: 10,
      runId: "run_jobicy_2",
      signal: new AbortController().signal,
    });
    expect(replay).toMatchObject({
      status: "succeeded",
      recordsFetched: 4,
      recordsAccepted: 3,
      recordsRejected: 1,
      recordsUnchanged: 4,
    });
    expect(await storage.jobs.listAll()).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(2);
    storage.close();
  });

  it("treats a conditional 304 as unchanged instead of aging every listing", async () => {
    const storage = await createStorage();
    const policy = await loadEnabledPolicy("jobicy");
    const body = await loadJson(new URL("jobicy/page-1.json", fixtureRoot));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(body, { headers: { etag: '"jobicy-v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const connector = createJobicyConnector({ policy, fetch });
    await runConnectorIngestion({
      connector,
      storage,
      purpose: "job_discovery",
      now: "2026-08-29T10:00:00.000Z",
      limit: 10,
      runId: "run_jobicy_conditional_1",
      signal: new AbortController().signal,
    });

    const unchanged = await runConnectorIngestion({
      connector,
      storage,
      purpose: "job_discovery",
      now: "2026-08-29T16:00:00.000Z",
      limit: 10,
      runId: "run_jobicy_conditional_2",
      signal: new AbortController().signal,
    });
    expect(unchanged).toMatchObject({ status: "succeeded", notModified: true });
    const jobs = await storage.jobs.listAll();
    expect(jobs).toHaveLength(3);
    expect(jobs.every(({ status }) => status === "open")).toBe(true);
    await expect(storage.ingestion.getSourceState("jobicy", "default")).resolves.toMatchObject({
      etag: '"jobicy-v1"',
    });
    storage.close();
  });

  it("ages listings only after two complete empty source snapshots", async () => {
    const storage = await createStorage();
    const policy = await loadEnabledPolicy("jobicy");
    const body = await loadJson(new URL("jobicy/page-1.json", fixtureRoot));
    const emptyBody = { apiVersion: "2.0", status: "success", jobCount: 0, jobs: [] };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(body))
      .mockResolvedValueOnce(Response.json(emptyBody))
      .mockResolvedValueOnce(Response.json(emptyBody));
    const connector = createJobicyConnector({ policy, fetch });

    for (const [runId, current] of [
      ["run_empty_1", "2026-08-29T10:00:00.000Z"],
      ["run_empty_2", "2026-08-29T16:00:00.000Z"],
      ["run_empty_3", "2026-08-29T22:00:00.000Z"],
    ] as const) {
      await runConnectorIngestion({
        connector,
        storage,
        purpose: "job_discovery",
        now: current,
        limit: 10,
        runId,
        signal: new AbortController().signal,
      });
    }

    const jobs = await storage.jobs.listAll();
    expect(jobs).toHaveLength(3);
    expect(jobs.every(({ status }) => status === "closed")).toBe(true);
    storage.close();
  });

  it("records a disabled source as policy-blocked without making a request", async () => {
    const storage = await createStorage();
    const policy = await loadPolicy("arbeitnow");
    const fetch = vi.fn();
    const connector = createArbeitnowConnector({ policy, fetch });
    const events: string[] = [];

    const result = await runConnectorIngestion({
      connector,
      storage,
      purpose: "evaluation",
      now: "2026-08-29T10:00:00.000Z",
      limit: 10,
      runId: "run_arbeitnow_blocked",
      signal: new AbortController().signal,
      onEvent: (event) => {
        events.push(event.type);
      },
    });

    expect(result).toMatchObject({ status: "skipped", errorCode: "FORBIDDEN" });
    expect(fetch).not.toHaveBeenCalled();
    expect(events).toEqual(["run_started", "policy_blocked"]);
    expect(await storage.ingestion.getSourceState("arbeitnow", "default")).toMatchObject({
      health: "disabled",
      consecutiveFailures: 0,
    });
    storage.close();
  });

  it("keeps ingestion authoritative when optional event publication fails", async () => {
    const storage = await createStorage();
    const policy = await loadEnabledPolicy("jobicy");
    const body = await loadJson(new URL("jobicy/page-1.json", fixtureRoot));
    const connector = createJobicyConnector({ policy, fetch: async () => Response.json(body) });
    const onEvent = vi.fn(async () => {
      throw new Error("realtime unavailable");
    });

    const result = await runConnectorIngestion({
      connector,
      storage,
      purpose: "job_discovery",
      now: "2026-08-29T10:00:00.000Z",
      limit: 10,
      runId: "run_event_failure",
      signal: new AbortController().signal,
      onEvent,
    });

    expect(result).toMatchObject({ status: "succeeded", recordsAccepted: 3 });
    expect(onEvent).toHaveBeenCalled();
    await expect(storage.ingestion.getRunById("run_event_failure")).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(await storage.jobs.listAll()).toHaveLength(3);
    storage.close();
  });

  it("isolates one source failure so the remaining connectors still run", async () => {
    const storage = await createStorage();
    const remoteOkPolicy = await loadEnabledPolicy("remoteok");
    const jobicyPolicy = await loadEnabledPolicy("jobicy");
    const jobicyBody = await loadJson(new URL("jobicy/page-1.json", fixtureRoot));
    const failingFetch = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const succeedingFetch = vi.fn(async () => Response.json(jobicyBody));

    const results = await runConnectorBatch({
      connectors: [
        createRemoteOkConnector({ policy: remoteOkPolicy, fetch: failingFetch }),
        createJobicyConnector({ policy: jobicyPolicy, fetch: succeedingFetch }),
      ],
      storage,
      purpose: "job_discovery",
      now: "2026-08-29T10:00:00.000Z",
      limit: 10,
      signal: new AbortController().signal,
      runIdFor: (sourceKey) => `run_batch_${sourceKey}`,
    });

    expect(results.map(({ status, errorCode }) => ({ status, errorCode }))).toEqual([
      { status: "failed", errorCode: "DEPENDENCY" },
      { status: "succeeded", errorCode: null },
    ]);
    expect(failingFetch).toHaveBeenCalledOnce();
    expect(succeedingFetch).toHaveBeenCalledOnce();
    expect(await storage.jobs.listAll()).toHaveLength(3);
    storage.close();
  });
});
