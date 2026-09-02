import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  createAlertDeliverySender,
  recordWorkerCycle,
  runAlertDeliveryBatch,
  runAlertScheduler,
  runSearchAlertRetention,
} from "@jobbbler/worker";

import { configuredDatabaseUrl } from "./database-url";
import { getServerStorage } from "./context";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface AlertCycleSummary {
  readonly evaluated: number;
  readonly queued: number;
  readonly delivered: number;
  readonly failed: number;
  readonly purged: number;
  readonly heartbeatAt: string;
}

interface AlertCyclePostDependencies {
  readonly environment: RuntimeEnvironment;
  run(input: Readonly<{ signal: AbortSignal }>): Promise<AlertCycleSummary>;
}

function response(status: number, body: Readonly<Record<string, unknown>>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function authorized(request: Request, secret: string): boolean {
  const supplied = request.headers.get("authorization");
  if (supplied === null) return false;
  const expected = `Bearer ${secret}`;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

export function createAlertCyclePostHandler(
  dependencies: AlertCyclePostDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const secret = dependencies.environment["CRON_SECRET"]?.trim();
    if (secret === undefined || secret.length < 32) {
      return response(503, { status: "unavailable" });
    }
    if (!authorized(request, secret)) {
      const unauthorized = response(401, { status: "unauthorized" });
      unauthorized.headers.set("www-authenticate", "Bearer");
      return unauthorized;
    }

    try {
      const summary = await dependencies.run({ signal: request.signal });
      return response(200, { status: "completed", ...summary });
    } catch {
      return response(503, { status: "failed" });
    }
  };
}

const ALERT_BATCH_LIMIT = 50;
const RETENTION_BATCH_LIMIT = 100;

export async function runProductionAlertCycle(
  input: Readonly<{
    signal: AbortSignal;
  }>,
): Promise<AlertCycleSummary> {
  if (configuredDatabaseUrl(process.env) === undefined) {
    throw new Error("The production alert cycle requires PostgreSQL storage.");
  }

  const storage = getServerStorage();
  const startedAtMs = Date.now();
  const now = new Date().toISOString();
  const workerId = `worker_${randomUUID()}`;
  const sender = createAlertDeliverySender(process.env);
  const retention = await runSearchAlertRetention(
    storage.searchAlertPreparation,
    storage.idempotency,
    { now, limit: RETENTION_BATCH_LIMIT },
  );
  const scheduler = await runAlertScheduler({
    storage,
    now,
    limit: ALERT_BATCH_LIMIT,
  });
  const delivery = await runAlertDeliveryBatch({
    storage,
    now,
    workerId,
    limit: ALERT_BATCH_LIMIT,
    signal: input.signal,
    sender,
  });
  const completedAt = new Date().toISOString();
  const failed = delivery.failed + delivery.dead;
  const heartbeat = await recordWorkerCycle({
    audit: storage.audit,
    id: `audit_${randomUUID()}`,
    correlationId: `cycle_${randomUUID()}`,
    occurredAt: completedAt,
    durationMs: Math.max(0, Date.now() - startedAtMs),
    mode: "alert_once",
    databaseDriver: "postgres",
    catalog: null,
    alerts: {
      evaluated: scheduler.evaluated,
      queued: scheduler.queued,
      delivered: delivery.succeeded,
      failed,
    },
  });

  return {
    evaluated: scheduler.evaluated,
    queued: scheduler.queued,
    delivered: delivery.succeeded,
    failed,
    purged: retention.purgedPreparations + retention.purgedIdempotency,
    heartbeatAt: heartbeat.occurredAt,
  };
}
