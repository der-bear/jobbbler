import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { DomainError } from "@jobbbler/core-domain";

import { openSqliteDatabase } from "./connection.js";
import { migrateSqlite, verifySqliteMigrationJournal } from "./migrate.js";

export interface SqliteIntegritySummary {
  readonly migrations: number;
  readonly organizations: number;
  readonly jobs: number;
  readonly searchableJobs: number;
  readonly canonicalChecksum: string;
}

interface CountRow {
  readonly count: number;
}

interface IntegrityRow {
  readonly integrity_check: string;
}

const canonicalTableOrders = [
  ["schema_migrations", "version"],
  ["owners", "id"],
  ["agent_sessions", "id"],
  ["agent_delegations", "id"],
  ["data_grants", "id"],
  ["audit_events", "sequence"],
  ["outbox_events", "id"],
  ["work_items", "id"],
  ["idempotency_records", "scope, key"],
  ["organizations", "id"],
  ["jobs", "id"],
  ["saved_searches", "id"],
  ["schedules", "id"],
  ["search_runs", "id"],
  ["search_deltas", "id"],
  ["application_drafts", "id"],
  ["application_reviews", "id"],
  ["action_confirmations", "id"],
  ["application_submissions", "id"],
  ["source_states", "source_key, partition"],
  ["source_runs", "id"],
  ["source_records", "id"],
  ["source_payloads", "source_record_id"],
  ["normalization_results", "id"],
  ["source_run_records", "run_id, source_record_id"],
  ["job_versions", "id"],
  ["job_source_links", "source_key, partition, external_id"],
] as const;

export async function backupSqliteDatabase(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });
  try {
    await access(destinationPath);
    throw new DomainError({
      code: "CONFLICT",
      message: "SQLite backup destination already exists.",
    });
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const source = openSqliteDatabase(sourcePath);
  try {
    migrateSqlite(source);
    await source.backup(destinationPath);
  } finally {
    source.close();
  }
}

export function inspectSqliteDatabase(databasePath: string): SqliteIntegritySummary {
  const database = openSqliteDatabase(databasePath);
  try {
    verifySqliteMigrationJournal(database);
    const integrity = database.pragma("integrity_check") as IntegrityRow[];
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
      throw new Error("SQLite integrity_check did not return ok.");
    }
    const foreignKeyFailures = database.pragma("foreign_key_check") as unknown[];
    if (foreignKeyFailures.length > 0) throw new Error("SQLite foreign-key verification failed.");

    const migrations = database
      .prepare("SELECT count(*) AS count FROM schema_migrations")
      .get() as CountRow;
    const organizations = database
      .prepare("SELECT count(*) AS count FROM organizations")
      .get() as CountRow;
    const jobs = database.prepare("SELECT count(*) AS count FROM jobs").get() as CountRow;
    const searchableJobs = database
      .prepare("SELECT count(*) AS count FROM jobs_fts")
      .get() as CountRow;
    if (jobs.count !== searchableJobs.count) {
      throw new Error("SQLite FTS index is not synchronized with the jobs table.");
    }

    const canonicalRows = Object.fromEntries(
      canonicalTableOrders.map(([table, orderBy]) => [
        table,
        database.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all(),
      ]),
    );
    const canonicalChecksum = createHash("sha256")
      .update(JSON.stringify(canonicalRows))
      .digest("hex");

    return {
      migrations: migrations.count,
      organizations: organizations.count,
      jobs: jobs.count,
      searchableJobs: searchableJobs.count,
      canonicalChecksum,
    };
  } finally {
    database.close();
  }
}

export async function restoreAndVerifySqliteBackup(
  backupPath: string,
  restoredPath: string,
  expected: SqliteIntegritySummary,
): Promise<SqliteIntegritySummary> {
  await mkdir(dirname(restoredPath), { recursive: true });
  await copyFile(backupPath, restoredPath, constants.COPYFILE_EXCL);
  const restored = inspectSqliteDatabase(restoredPath);
  if (JSON.stringify(restored) !== JSON.stringify(expected)) {
    throw new Error("Restored SQLite database does not match its source snapshot.");
  }
  return restored;
}
