import { randomUUID } from "node:crypto";

import pino from "pino";

import { createCatalogConnectors, type JobConnector } from "@jobbbler/connectors";
import { jobbblerUserAgent } from "@jobbbler/core-domain";

import { runAlertDeliveryBatch, runAlertScheduler } from "./alert-worker.js";
import { createAlertDeliverySender } from "./alert-sender.js";
import { runLeasedConnectorBatch } from "./catalog-worker.js";
import {
  recordWorkerCycle,
  safeWorkerLogError,
  type ObservableWorkerMode,
} from "./observability.js";
import { runRecurringService } from "./service-loop.js";
import { runSearchAlertRetention } from "./search-alert-retention.js";
import { createConfiguredWorkerStorage } from "./storage.js";

const logger = pino({
  name: "jobbbler-worker",
  redact: {
    paths: [
      "authorization",
      "cookie",
      "email",
      "address",
      "ciphertext",
      "token",
      "databaseUrl",
      "databasePath",
      "*.authorization",
      "*.cookie",
      "*.email",
      "*.address",
      "*.ciphertext",
      "*.token",
      "*.payload",
    ],
    censor: "[REDACTED]",
  },
});

const SEARCH_ALERT_RETENTION_BATCH_LIMIT = 100;

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

type WorkerMode = ObservableWorkerMode | "idle";

function workerMode(value: string): WorkerMode {
  if (
    value === "catalog_once" ||
    value === "catalog_service" ||
    value === "alert_once" ||
    value === "alert_service" ||
    value === "all_once" ||
    value === "all_service" ||
    value === "idle"
  ) {
    return value;
  }
  throw new Error("Unsupported JOBBBLER_WORKER_MODE.");
}

function runsCatalog(mode: WorkerMode): boolean {
  return (
    mode === "catalog_once" ||
    mode === "catalog_service" ||
    mode === "all_once" ||
    mode === "all_service"
  );
}

function runsAlerts(mode: WorkerMode): boolean {
  return (
    mode === "alert_once" ||
    mode === "alert_service" ||
    mode === "all_once" ||
    mode === "all_service"
  );
}

function runsOnce(mode: WorkerMode): boolean {
  return mode.endsWith("_once");
}

async function main(): Promise<void> {
  const mode = workerMode(
    process.env["JOBBBLER_WORKER_MODE"] ??
      (process.env["NODE_ENV"] === "production" ? "all_service" : "idle"),
  );
  if (mode === "idle") {
    logger.info(
      { mode },
      "Worker is idle; set JOBBBLER_WORKER_MODE to a catalog, alert, or all mode to run",
    );
    return;
  }
  const configuredStorage = createConfiguredWorkerStorage();
  const { driver: databaseDriver, storage } = configuredStorage;
  const limit = positiveInteger(process.env["JOBBBLER_SOURCE_LIMIT"], 50, "Source limit");
  const intervalSeconds = positiveInteger(
    process.env["JOBBBLER_WORKER_INTERVAL_SECONDS"],
    300,
    "Worker interval",
  );
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Worker shutdown requested."));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const connectors = runsCatalog(mode)
      ? createCatalogConnectors((input, init) => fetch(input, init), {
          userAgent: jobbblerUserAgent(process.env, "/about/sources"),
        }).filter(
          ({ policy }) => policy.enabled && policy.allowedPurposes.includes("job_discovery"),
        )
      : [];
    const alertSender = runsAlerts(mode) ? createAlertDeliverySender(process.env) : null;
    const workerId = `worker_${randomUUID()}`;
    const runCycle = async () => {
      const startedAtMs = Date.now();
      const correlationId = `cycle_${randomUUID()}`;
      const now = new Date().toISOString();
      const searchAlertRetention = await runSearchAlertRetention(
        storage.searchAlertPreparation,
        storage.idempotency,
        {
          now,
          limit: SEARCH_ALERT_RETENTION_BATCH_LIMIT,
        },
      );
      const batch = runsCatalog(mode)
        ? await runLeasedConnectorBatch({
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
          })
        : null;
      const scheduler = runsAlerts(mode) ? await runAlertScheduler({ storage, now, limit }) : null;
      const alertDelivery =
        runsAlerts(mode) && alertSender !== null
          ? await runAlertDeliveryBatch({
              storage,
              now,
              workerId,
              limit,
              signal: controller.signal,
              sender: alertSender,
            })
          : null;
      const completedAt = new Date().toISOString();
      const heartbeat = await recordWorkerCycle({
        audit: storage.audit,
        id: `audit_${randomUUID()}`,
        correlationId,
        occurredAt: completedAt,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        mode,
        databaseDriver,
        catalog: batch?.work ?? null,
        alerts:
          scheduler === null && alertDelivery === null
            ? null
            : {
                evaluated: scheduler?.evaluated ?? 0,
                queued: scheduler?.queued ?? 0,
                delivered: alertDelivery?.succeeded ?? 0,
                failed: (alertDelivery?.failed ?? 0) + (alertDelivery?.dead ?? 0),
              },
      });
      logger.info(
        {
          mode,
          databaseDriver,
          correlationId,
          heartbeatAt: heartbeat.occurredAt,
          durationMs: heartbeat.safeMetadata["durationMs"],
          catalogWork: batch?.work ?? null,
          runs: (batch?.runs ?? []).map((run) => ({
            id: run.id,
            sourceKey: run.sourceKey,
            status: run.status,
            fetched: run.recordsFetched,
            accepted: run.recordsAccepted,
            rejected: run.recordsRejected,
            errorCode: run.errorCode,
          })),
          purgedPayloads: batch?.purgedPayloads ?? 0,
          purgedSearchAlertPreparations: searchAlertRetention.purgedPreparations,
          purgedSearchAlertIdempotency: searchAlertRetention.purgedIdempotency,
          searchAlertRetentionFailures: searchAlertRetention.failed,
          alertScheduler: scheduler,
          alertDelivery,
        },
        "Worker cycle completed",
      );
    };

    if (runsOnce(mode)) await runCycle();
    else {
      await runRecurringService({
        intervalMilliseconds: intervalSeconds * 1_000,
        signal: controller.signal,
        runCycle,
        onCycleError: (error) => {
          logger.error(safeWorkerLogError(error), "Worker cycle failed; the service will retry");
        },
      });
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await storage.close();
  }
}

await main();
