import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createArbeitnowConnector,
  createJobicyConnector,
  createRemoteOkConnector,
  sourceKeySchema,
  sourcePolicySchema,
  type FetchLike,
  type JobConnector,
  type SourceKey,
  type SourcePolicy,
} from "../packages/connectors/src/index.js";
import { createSqliteStorage } from "../packages/storage-sqlite/src/index.js";

import { runLeasedConnectorBatch } from "../apps/worker/src/catalog-worker.js";

interface Arguments {
  readonly live: boolean;
  readonly sourceKeys: readonly SourceKey[];
  readonly databasePath: string;
  readonly limit: number;
}

const fixtureRoot = new URL("../fixtures/connectors/", import.meta.url);
const policyRoot = new URL("../packages/connectors/source-policies/", import.meta.url);
const allSourceKeys = sourceKeySchema.options;

function valueAfter(arguments_: readonly string[], flag: string): string | null {
  const index = arguments_.indexOf(flag);
  return index === -1 ? null : (arguments_[index + 1] ?? null);
}

function parseArguments(arguments_: readonly string[]): Arguments {
  const sourceValue = valueAfter(arguments_, "--source") ?? "all";
  const sourceKeys = sourceValue === "all" ? allSourceKeys : [sourceKeySchema.parse(sourceValue)];
  const limitValue = Number(valueAfter(arguments_, "--limit") ?? "50");
  if (!Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 500) {
    throw new Error("--limit must be an integer between 1 and 500.");
  }
  return {
    live: arguments_.includes("--live"),
    sourceKeys,
    databasePath: resolve(
      valueAfter(arguments_, "--database") ??
        process.env["SQLITE_DATABASE_PATH"] ??
        ".data/jobbbler.sqlite",
    ),
    limit: limitValue,
  };
}

async function readJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(url), "utf8")) as unknown;
}

async function loadPolicy(sourceKey: SourceKey): Promise<SourcePolicy> {
  return sourcePolicySchema.parse(await readJson(new URL(`${sourceKey}.json`, policyRoot)));
}

async function createFixtureFetch(): Promise<FetchLike> {
  const fixtures = new Map<string, unknown>(
    await Promise.all(
      allSourceKeys.map(
        async (sourceKey) =>
          [sourceKey, await readJson(new URL(`${sourceKey}/page-1.json`, fixtureRoot))] as const,
      ),
    ),
  );
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const sourceKey = url.hostname.includes("jobicy")
      ? "jobicy"
      : url.hostname.includes("remoteok")
        ? "remoteok"
        : "arbeitnow";
    return Response.json(fixtures.get(sourceKey), {
      headers: {
        etag: `"fixture-${sourceKey}-v1"`,
        "last-modified": "Sat, 29 Aug 2026 10:00:00 GMT",
      },
    });
  };
}

function createConnector(
  sourceKey: SourceKey,
  policy: SourcePolicy,
  fetch: FetchLike,
): JobConnector {
  if (sourceKey === "jobicy") return createJobicyConnector({ policy, fetch });
  if (sourceKey === "remoteok") return createRemoteOkConnector({ policy, fetch });
  return createArbeitnowConnector({ policy, fetch });
}

const arguments_ = parseArguments(process.argv.slice(2));
const fetchImplementation: FetchLike = arguments_.live
  ? (input, init) => fetch(input, init)
  : await createFixtureFetch();
const storage = createSqliteStorage(arguments_.databasePath);
const controller = new AbortController();
const stop = () => controller.abort(new Error("Catalog ingestion interrupted."));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  const now = new Date().toISOString();
  const connectors = await Promise.all(
    arguments_.sourceKeys.map(async (sourceKey) =>
      createConnector(sourceKey, await loadPolicy(sourceKey), fetchImplementation),
    ),
  );
  const batch = await runLeasedConnectorBatch({
    connectors,
    storage,
    now,
    workerId: `worker_${randomUUID()}`,
    workIdFor: (sourceKey) => `work_catalog_${sourceKey}_${randomUUID()}`,
    runIdFor: (sourceKey) => `run_catalog_${sourceKey}_${randomUUID()}`,
    purposeFor: (sourceKey) => (sourceKey === "arbeitnow" ? "evaluation" : "job_discovery"),
    limit: arguments_.limit,
    signal: controller.signal,
  });
  const results = batch.runs.map((result) => ({
    sourceKey: result.sourceKey,
    status: result.status,
    fetched: result.recordsFetched,
    accepted: result.recordsAccepted,
    rejected: result.recordsRejected,
    unchanged: result.recordsUnchanged,
    errorCode: result.errorCode,
  }));
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: arguments_.live ? "live" : "fixtures",
        work: batch.work,
        results,
        purgedPayloads: batch.purgedPayloads,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  storage.close();
}
