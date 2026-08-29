import { resolve } from "node:path";

import { inspectSqliteDatabase, type SqliteIntegritySummary } from "@jobbbler/storage-sqlite";
import {
  postgresMigrationManifest,
  type PostgresMigration,
  type PostgresStorage,
} from "@jobbbler/storage-postgres";

import { apiErrorResponse, apiSuccessResponse } from "./api-response";
import { createRequestId, getServerStorage, type RuntimeStorage } from "./context";
import { validateRuntimeConfiguration } from "./runtime-configuration";

interface ReadinessSummary {
  readonly driver: "sqlite" | "postgres";
  readonly migrations: number;
  readonly organizations: number;
  readonly jobs: number;
}

type Inspector = () => Promise<ReadinessSummary> | ReadinessSummary;

type MigrationJournalEntry = Pick<PostgresMigration, "version" | "name" | "checksum">;

export function validatePostgresMigrationJournal(
  applied: readonly MigrationJournalEntry[],
  expected: readonly MigrationJournalEntry[],
): void {
  const matches =
    expected.length > 0 &&
    applied.length === expected.length &&
    applied.every((row, index) => {
      const source = expected[index];
      return (
        source !== undefined &&
        row.version === source.version &&
        row.name === source.name &&
        row.checksum === source.checksum
      );
    });
  if (!matches) {
    throw new Error(
      "PostgreSQL migration journal is incomplete or does not match the release manifest.",
    );
  }
}

export function assertFreshWorkerHeartbeat(
  heartbeatAt: string | null,
  now: string,
  maximumAgeSeconds: number,
): void {
  if (
    !Number.isSafeInteger(maximumAgeSeconds) ||
    maximumAgeSeconds < 60 ||
    maximumAgeSeconds > 86_400
  ) {
    throw new Error("Worker heartbeat maximum age is invalid.");
  }
  const nowMs = Date.parse(now);
  const heartbeatMs = heartbeatAt === null ? Number.NaN : Date.parse(heartbeatAt);
  if (heartbeatAt === null || Number.isNaN(heartbeatMs) || Number.isNaN(nowMs)) {
    throw new Error("Production worker heartbeat is missing.");
  }
  const ageMs = nowMs - heartbeatMs;
  if (ageMs < -60_000 || ageMs > maximumAgeSeconds * 1_000) {
    throw new Error("Production worker heartbeat is stale.");
  }
}

function workerHeartbeatMaximumAge(environment: NodeJS.ProcessEnv): number {
  const configured = environment["WORKER_HEARTBEAT_MAX_AGE_SECONDS"];
  const value = configured === undefined ? 900 : Number(configured);
  if (!Number.isSafeInteger(value) || value < 60 || value > 86_400) {
    throw new Error("WORKER_HEARTBEAT_MAX_AGE_SECONDS must be between 60 and 86400.");
  }
  return value;
}

function isPostgresStorage(storage: RuntimeStorage): storage is PostgresStorage {
  return "sql" in storage;
}

async function defaultInspector(): Promise<ReadinessSummary> {
  const runtime = validateRuntimeConfiguration();
  const storage = getServerStorage();
  if (isPostgresStorage(storage)) {
    if (runtime.databaseDriver !== "postgres") {
      throw new Error("Runtime database selection does not match the validated configuration.");
    }
    const expectedMigrations = postgresMigrationManifest();
    const appliedMigrations = await storage.sql<MigrationJournalEntry[]>`
      SELECT version, name, checksum
      FROM jobbbler.schema_migrations
      ORDER BY version`;
    validatePostgresMigrationJournal(appliedMigrations, expectedMigrations);
    if (runtime.environment === "production") {
      const heartbeatRows = await storage.sql<{ readonly occurred_at: string | null }[]>`
        SELECT body->>'occurredAt' AS occurred_at
        FROM jobbbler.entity_records
        WHERE kind = 'audit'
          AND body->>'type' = 'worker.cycle.completed'
          AND body->>'aggregateType' = 'system'
          AND body->>'aggregateId' = 'worker_cycle'
        ORDER BY body->>'occurredAt' DESC, id DESC
        LIMIT 1`;
      assertFreshWorkerHeartbeat(
        heartbeatRows[0]?.occurred_at ?? null,
        new Date().toISOString(),
        workerHeartbeatMaximumAge(process.env),
      );
    }
    const rows = await storage.sql<{ readonly organizations: string; readonly jobs: string }[]>`
      SELECT
        (SELECT count(*)::text FROM jobbbler.entity_records WHERE kind = 'organization') AS organizations,
        (SELECT count(*)::text FROM jobbbler.entity_records WHERE kind = 'job') AS jobs`;
    const row = rows[0];
    if (row === undefined) throw new Error("PostgreSQL readiness query returned no summary.");
    return {
      driver: "postgres",
      migrations: expectedMigrations.length,
      organizations: Number(row.organizations),
      jobs: Number(row.jobs),
    };
  }
  if (runtime.databaseDriver !== "sqlite") {
    throw new Error("Runtime database selection does not match the validated configuration.");
  }
  const base = process.env["INIT_CWD"] ?? process.cwd();
  const summary: SqliteIntegritySummary = inspectSqliteDatabase(
    resolve(base, process.env["SQLITE_DATABASE_PATH"] ?? ".data/jobbbler.sqlite"),
  );
  return {
    driver: "sqlite",
    migrations: summary.migrations,
    organizations: summary.organizations,
    jobs: summary.jobs,
  };
}

export async function handleLiveHealthRequest(): Promise<Response> {
  return apiSuccessResponse(
    { status: "live" },
    { requestId: createRequestId(), cacheControl: "no-store" },
  );
}

export async function handleReadyHealthRequest(
  input: { readonly inspect?: Inspector } = {},
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const summary = await (input.inspect ?? defaultInspector)();
    return apiSuccessResponse(
      {
        status: "ready",
        driver: summary.driver,
        migrations: summary.migrations,
        organizations: summary.organizations,
        jobs: summary.jobs,
      },
      { requestId, cacheControl: "no-store" },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId, status: 503 });
  }
}
