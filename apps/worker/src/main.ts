import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import pino from "pino";

import { createCatalogConnectors, type JobConnector } from "@jobbbler/connectors";
import { createSqliteStorage } from "@jobbbler/storage-sqlite";

import { runLeasedConnectorBatch } from "./catalog-worker.js";
import { runRecurringService } from "./service-loop.js";

const logger = pino({ name: "jobbbler-worker" });

function positiveInteger(value: string | undefined, fallback: number, label: string): number {
  const parsed = Number(value ?? String(fallback));
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function workBucket(connector: JobConnector, now: string): string {
  const interval = connector.policy.minimumPollIntervalSeconds * 1_000;
  return String(Math.floor(Date.parse(now) / interval));
}

async function main(): Promise<void> {
  const mode =
    process.env["JOBBBLER_WORKER_MODE"] ??
    (process.env["NODE_ENV"] === "production" ? "catalog_service" : "idle");
  if (mode === "idle") {
    logger.info(
      { mode },
      "Worker is idle; set JOBBBLER_WORKER_MODE=catalog_once or catalog_service to run",
    );
    return;
  }
  if (mode !== "catalog_once" && mode !== "catalog_service") {
    throw new Error("Unsupported JOBBBLER_WORKER_MODE.");
  }

  const databasePath = resolve(process.env["SQLITE_DATABASE_PATH"] ?? ".data/jobbbler.sqlite");
  const limit = positiveInteger(process.env["JOBBBLER_SOURCE_LIMIT"], 50, "Source limit");
  const intervalSeconds = positiveInteger(
    process.env["JOBBBLER_WORKER_INTERVAL_SECONDS"],
    300,
    "Worker interval",
  );
  const storage = createSqliteStorage(databasePath);
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Worker shutdown requested."));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const connectors = createCatalogConnectors((input, init) => fetch(input, init)).filter(
      ({ policy }) => policy.enabled && policy.allowedPurposes.includes("job_discovery"),
    );
    const workerId = `worker_${randomUUID()}`;
    const runCycle = async () => {
      const now = new Date().toISOString();
      const batch = await runLeasedConnectorBatch({
        connectors,
        storage,
        now,
        workerId,
        workIdFor: (sourceKey) => {
          const connector = connectors.find(({ descriptor }) => descriptor.key === sourceKey);
          if (connector === undefined) throw new Error("Missing connector for work bucket.");
          return `work_catalog_${sourceKey}_${workBucket(connector, now)}`;
        },
        runIdFor: (sourceKey, attempt, workItemId) =>
          `run_catalog_${sourceKey}_${workItemId}_${String(attempt)}_${randomUUID()}`,
        purposeFor: () => "job_discovery",
        limit,
        signal: controller.signal,
        onEvent: (event) => {
          logger.info({ event }, "Catalog activity");
        },
      });
      logger.info(
        {
          mode,
          databasePath,
          work: batch.work,
          runs: batch.runs.map((run) => ({
            id: run.id,
            sourceKey: run.sourceKey,
            status: run.status,
            fetched: run.recordsFetched,
            accepted: run.recordsAccepted,
            rejected: run.recordsRejected,
            errorCode: run.errorCode,
          })),
          purgedPayloads: batch.purgedPayloads,
        },
        "Catalog worker cycle completed",
      );
    };

    if (mode === "catalog_once") await runCycle();
    else {
      await runRecurringService({
        intervalMilliseconds: intervalSeconds * 1_000,
        signal: controller.signal,
        runCycle,
        onCycleError: (error) => {
          logger.error({ error }, "Catalog worker cycle failed; the service will retry");
        },
      });
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    storage.close();
  }
}

await main();
