import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { openSqliteDatabase } from "../packages/storage-sqlite/src/connection.js";

export const SQLITE_EXPORT_FORMAT_VERSION = 2;

export type SnapshotTableMode = "entity" | "aggregate" | "relational" | "staged_only";

/**
 * Every durable SQLite table must be classified here. Export fails closed when
 * a newer schema adds an unclassified table, preventing a cutover from silently
 * dropping production state. `staged_only` tables are superseded legacy models
 * retained in the forensic staging layer but not loaded into current adapters.
 */
export const SNAPSHOT_TABLE_MODES = {
  owners: "entity",
  organizations: "entity",
  jobs: "entity",
  job_location_suggestions: "aggregate",
  saved_searches: "entity",
  schedules: "entity",
  owner_sessions: "entity",
  verification_endpoints: "entity",
  verification_challenges: "entity",
  owner_recovery_challenges: "entity",
  owner_deletion_intents: "entity",
  alert_evaluations: "aggregate",
  alert_evaluation_baselines: "aggregate",
  alert_changes: "entity",
  notification_deliveries: "entity",
  application_drafts: "entity",
  application_review_records: "entity",
  application_confirmation_records: "entity",
  application_submission_receipts: "entity",
  application_agent_sessions: "entity",
  application_delegation_records: "entity",
  application_data_grant_records: "entity",
  application_data_grant_bindings: "entity",
  work_items: "entity",
  audit_events: "entity",
  owner_activity_events: "relational",
  idempotency_records: "entity",
  source_states: "entity",
  source_runs: "entity",
  source_records: "aggregate",
  source_payloads: "aggregate",
  normalization_results: "aggregate",
  source_run_records: "entity",
  job_versions: "entity",
  job_source_links: "entity",
  rate_limit_windows: "relational",
  agent_sessions: "staged_only",
  agent_delegations: "staged_only",
  data_grants: "staged_only",
  outbox_events: "staged_only",
  search_runs: "staged_only",
  search_deltas: "staged_only",
  application_reviews: "staged_only",
  action_confirmations: "staged_only",
  application_submissions: "staged_only",
} as const satisfies Readonly<Record<string, SnapshotTableMode>>;

export interface SnapshotManifest {
  readonly type: "manifest";
  readonly formatVersion: number;
  readonly sqliteSchemaVersion: number;
  readonly checksum: string;
  readonly rowCount: number;
  readonly tables: Readonly<Record<string, number>>;
  readonly tableModes: Readonly<Record<string, SnapshotTableMode>>;
}

interface SnapshotRow {
  readonly type: "row";
  readonly table: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function stableLine(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

type ChecksumManifest = Omit<SnapshotManifest, "checksum">;

export function calculateSnapshotChecksum(
  manifest: ChecksumManifest,
  body: readonly string[],
): string {
  return createHash("sha256")
    .update([stableLine(manifest), ...body].join("\n"))
    .digest("hex");
}

/** Exports real SQLite tables, excluding FTS implementation tables and migration journal. */
export async function exportSqliteSnapshot(
  sourcePath: string,
  destinationPath: string,
): Promise<SnapshotManifest> {
  const database = openSqliteDatabase(sourcePath);
  try {
    const discoveredTables = database
      .prepare(
        `SELECT name FROM pragma_table_list
         WHERE schema = 'main' AND type = 'table'
           AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
         ORDER BY name`,
      )
      .all() as { readonly name: string }[];
    const portableTables = Object.keys(SNAPSHOT_TABLE_MODES);
    const discoveredNames = discoveredTables.map(({ name }) => name);
    const unclassified = discoveredNames.filter((name) => !(name in SNAPSHOT_TABLE_MODES));
    const missing = portableTables.filter((name) => !discoveredNames.includes(name));
    if (unclassified.length > 0 || missing.length > 0) {
      throw new Error(
        `SQLite schema is not exportable: unclassified tables [${unclassified.join(", ")}], missing tables [${missing.join(", ")}].`,
      );
    }
    const schemaRow = database
      .prepare("SELECT coalesce(max(version), 0) AS version FROM schema_migrations")
      .get() as { readonly version: number };
    const rows: SnapshotRow[] = [];
    const counts: Record<string, number> = {};
    for (const name of portableTables) {
      // Name originates from sqlite_master and is quoted defensively.
      const quoted = `"${name.replaceAll('"', '""')}"`;
      const tableRows = database.prepare(`SELECT * FROM ${quoted}`).all() as Record<
        string,
        unknown
      >[];
      const serialized = tableRows
        .map((data): SnapshotRow => ({
          type: "row",
          table: name,
          data: canonicalize(data) as Record<string, unknown>,
        }))
        .sort((left, right) => stableLine(left.data).localeCompare(stableLine(right.data)));
      rows.push(...serialized);
      counts[name] = serialized.length;
    }
    const body = rows.map(stableLine);
    const checksumManifest: ChecksumManifest = {
      type: "manifest",
      formatVersion: SQLITE_EXPORT_FORMAT_VERSION,
      sqliteSchemaVersion: schemaRow.version,
      rowCount: rows.length,
      tables: counts,
      tableModes: SNAPSHOT_TABLE_MODES,
    };
    const manifest: SnapshotManifest = {
      ...checksumManifest,
      checksum: calculateSnapshotChecksum(checksumManifest, body),
    };
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, [stableLine(manifest), ...body].join("\n") + "\n", "utf8");
    return manifest;
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  const source = resolve(
    process.argv[2] ?? process.env["SQLITE_DATABASE_PATH"] ?? "var/jobbbler.sqlite",
  );
  const destination = resolve(process.argv[3] ?? "var/jobbbler-export.ndjson");
  exportSqliteSnapshot(source, destination).then((manifest) =>
    process.stdout.write(`${JSON.stringify(manifest)}\n`),
  );
}
