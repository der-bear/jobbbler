import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createJobicyConnector, sourcePolicySchema } from "@jobbbler/connectors";
import { createSqliteStorage } from "@jobbbler/storage-sqlite";

import { runLeasedConnectorBatch } from "./catalog-worker.js";

const temporaryDirectories: string[] = [];
const fixtureRoot = new URL("../../../fixtures/connectors/", import.meta.url);
const policyRoot = new URL("../../../packages/connectors/source-policies/", import.meta.url);

async function json(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(url), "utf8")) as unknown;
}

describe("leased catalog worker", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("executes catalog ingestion through a claimed work item", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-catalog-worker-"));
    temporaryDirectories.push(directory);
    const storage = createSqliteStorage(join(directory, "jobbbler.sqlite"));
    const policy = sourcePolicySchema.parse({
      ...((await json(new URL("jobicy.json", policyRoot))) as object),
      enabled: true,
    });
    const body = await json(new URL("jobicy/page-1.json", fixtureRoot));
    const connector = createJobicyConnector({
      policy,
      fetch: vi.fn(async () => Response.json(body)),
    });

    const result = await runLeasedConnectorBatch({
      connectors: [connector],
      storage,
      now: "2026-08-29T10:00:00.000Z",
      workerId: "catalog-worker-a",
      workIdFor: () => "work_catalog_jobicy_1",
      runIdFor: () => "run_catalog_jobicy_1",
      purposeFor: () => "job_discovery",
      limit: 10,
      signal: new AbortController().signal,
      random: () => 0.5,
    });

    expect(result.work).toEqual({ claimed: 1, succeeded: 1, failed: 0, dead: 0 });
    expect(result.runs).toEqual([
      expect.objectContaining({ sourceKey: "jobicy", status: "succeeded", recordsAccepted: 3 }),
    ]);
    expect(result.purgedPayloads).toBe(0);
    await expect(storage.workItems.getById("work_catalog_jobicy_1")).resolves.toMatchObject({
      status: "succeeded",
      attempt: 1,
    });
    storage.close();
  });
});
