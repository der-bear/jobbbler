import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openPostgresDatabase } from "../packages/storage-postgres/src/connection.js";
import { migratePostgres } from "../packages/storage-postgres/src/migrate.js";
import {
  calculateSnapshotChecksum,
  SNAPSHOT_TABLE_MODES,
  SQLITE_EXPORT_FORMAT_VERSION,
  stableLine,
  type SnapshotManifest,
} from "./export-sqlite.js";

export interface SnapshotRow {
  readonly type: "row";
  readonly table: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ImportedEntity {
  readonly kind: string;
  readonly id: string;
  readonly ownerId: string | null;
  readonly body: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ImportedOwnerActivity {
  readonly sequence: number;
  readonly id: string;
  readonly ownerId: string;
  readonly schemaVersion: number;
  readonly kind: string;
  readonly activityKey: string;
  readonly status: string;
  readonly safeSummary: string;
  readonly correlationId: string;
  readonly actorKind: string;
  readonly aggregateType: string;
  readonly aggregateVersion: number;
  readonly occurredAt: string;
  readonly effects: readonly unknown[];
}

export interface ImportedRateLimitWindow {
  readonly key: string;
  readonly count: number;
  readonly resetAtMs: number;
}

export interface SnapshotImportPlan {
  readonly entities: readonly ImportedEntity[];
  readonly ownerActivities: readonly ImportedOwnerActivity[];
  readonly rateLimitWindows: readonly ImportedRateLimitWindow[];
  readonly stagedOnlyTables: readonly string[];
  readonly entityCounts: Readonly<Record<string, number>>;
}

export interface ParsedSnapshot {
  readonly manifest: SnapshotManifest;
  readonly rows: readonly SnapshotRow[];
}

export interface ImportedSnapshot {
  readonly snapshotId: string;
  readonly checksum: string;
  readonly rowCount: number;
  readonly entityCount: number;
  readonly ownerActivityCount: number;
}

type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${label} must be an integer at least ${String(minimum)}.`);
  return value;
}

function boolean(value: unknown): boolean {
  return value === 1 || value === true;
}

function camelizeRow(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(data)) {
    const name = key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    if (key.endsWith("_json") && typeof item === "string")
      value[name.slice(0, -4)] = JSON.parse(item) as unknown;
    else value[name] = item;
  }
  return value;
}

function timestamp(value: unknown, fallback = "1970-01-01T00:00:00.000Z"): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error("Snapshot timestamp is invalid.");
  return instant.toISOString();
}

function entityMetadata(
  body: Readonly<Record<string, unknown>>,
): Pick<ImportedEntity, "ownerId" | "version" | "createdAt" | "updatedAt"> {
  const ownerId = typeof body["ownerId"] === "string" ? body["ownerId"] : null;
  const version =
    typeof body["version"] === "number" && Number.isSafeInteger(body["version"])
      ? body["version"]
      : 0;
  const createdAt = timestamp(
    body["createdAt"] ??
      body["publishedAt"] ??
      body["startedAt"] ??
      body["firstFetchedAt"] ??
      body["observedAt"] ??
      body["occurredAt"] ??
      body["updatedAt"],
  );
  const updatedAt = timestamp(
    body["updatedAt"] ??
      body["completedAt"] ??
      body["lastSeenAt"] ??
      body["recordedAt"] ??
      body["observedAt"] ??
      body["occurredAt"],
    createdAt,
  );
  return { ownerId, version, createdAt, updatedAt };
}

function entity(kind: string, id: string, body: Readonly<Record<string, unknown>>): ImportedEntity {
  return { kind, id, body, ...entityMetadata(body) };
}

function parseManifest(value: unknown): SnapshotManifest {
  const manifest = record(value, "Snapshot manifest") as unknown as SnapshotManifest;
  if (manifest.type !== "manifest" || manifest.formatVersion !== SQLITE_EXPORT_FORMAT_VERSION)
    throw new Error("Snapshot manifest is unsupported.");
  if (!Number.isSafeInteger(manifest.sqliteSchemaVersion) || manifest.sqliteSchemaVersion < 1)
    throw new Error("Snapshot SQLite schema version is invalid.");
  if (!/^[a-f0-9]{64}$/.test(manifest.checksum)) throw new Error("Snapshot checksum is invalid.");
  if (!Number.isSafeInteger(manifest.rowCount) || manifest.rowCount < 0)
    throw new Error("Snapshot row count is invalid.");
  if (stableLine(manifest.tableModes) !== stableLine(SNAPSHOT_TABLE_MODES))
    throw new Error("Snapshot table classification does not match this importer.");
  return manifest;
}

export function parseSnapshot(contents: string): ParsedSnapshot {
  const lines = contents.trimEnd().split("\n");
  const first = lines.shift();
  if (first === undefined || first.length === 0) throw new Error("Snapshot is empty.");
  const manifest = parseManifest(JSON.parse(first) as unknown);
  const rows = lines.map((line, index): SnapshotRow => {
    const parsed = record(JSON.parse(line) as unknown, `Snapshot row ${String(index)}`);
    if (parsed["type"] !== "row")
      throw new Error(`Snapshot row ${String(index)} has an invalid type.`);
    const table = string(parsed["table"], `Snapshot row ${String(index)} table`);
    if (!(table in SNAPSHOT_TABLE_MODES))
      throw new Error(`Snapshot row ${String(index)} has an unclassified table.`);
    return {
      type: "row",
      table,
      data: record(parsed["data"], `Snapshot row ${String(index)} data`),
    };
  });
  const { checksum: _checksum, ...checksumManifest } = manifest;
  const checksum = calculateSnapshotChecksum(checksumManifest, lines);
  if (checksum !== manifest.checksum || rows.length !== manifest.rowCount)
    throw new Error("Snapshot checksum or row count does not match its manifest.");
  const actualCounts: Record<string, number> = Object.fromEntries(
    Object.keys(SNAPSHOT_TABLE_MODES).map((table) => [table, 0]),
  );
  for (const row of rows) actualCounts[row.table] = (actualCounts[row.table] ?? 0) + 1;
  if (stableLine(actualCounts) !== stableLine(manifest.tables))
    throw new Error("Snapshot per-table counts do not match its manifest.");
  return { manifest, rows };
}

const directKinds: Readonly<Record<string, string>> = {
  owners: "owner",
  organizations: "organization",
  saved_searches: "saved_search",
  schedules: "schedule",
  owner_sessions: "owner_session",
  verification_endpoints: "verification_endpoint",
  verification_challenges: "verification_challenge",
  owner_recovery_challenges: "owner_recovery_challenge",
  owner_deletion_intents: "owner_deletion_intent",
  alert_changes: "alert_change",
  notification_deliveries: "alert_delivery",
  application_drafts: "application",
  application_review_records: "application_review",
  application_confirmation_records: "application_confirmation",
  application_submission_receipts: "application_receipt",
  application_agent_sessions: "agent_session",
  application_delegation_records: "delegation",
  application_data_grant_records: "data_grant",
  application_data_grant_bindings: "rich_data_grant",
  work_items: "work_item",
  audit_events: "audit",
  source_runs: "source_run",
  job_versions: "job_version",
  job_source_links: "job_source_link",
};

function jobEntity(row: SnapshotRow): ImportedEntity {
  const value = camelizeRow(row.data);
  const id = string(value["id"], "Job ID");
  const salary =
    value["salaryCurrency"] === null
      ? null
      : {
          minimum: value["salaryMinimum"],
          maximum: value["salaryMaximum"],
          currency: value["salaryCurrency"],
          period: value["salaryPeriod"],
        };
  return entity("job", id, {
    id,
    organizationId: value["organizationId"],
    organizationName: value["organizationName"],
    title: value["title"],
    summary: value["summary"],
    categories: value["categories"],
    workModel: value["workModel"],
    employmentType: value["employmentType"],
    seniority: value["seniority"],
    locations: value["locations"],
    skills: value["skills"],
    salary,
    source: { key: value["sourceKey"], label: value["sourceLabel"], url: value["sourceUrl"] },
    applyMode: value["applyMode"],
    status: value["status"],
    publishedAt: value["publishedAt"],
    updatedAt: value["updatedAt"],
  });
}

function directEntity(row: SnapshotRow): ImportedEntity | null {
  if (row.table === "jobs") return jobEntity(row);
  const value = camelizeRow(row.data);
  if (row.table === "idempotency_records") {
    const scope = string(value["scope"], "Idempotency scope");
    const key = string(value["key"], "Idempotency key");
    const id = `${scope}:${key}`;
    return entity("idempotency", id, { id, ...value });
  }
  if (row.table === "source_states") {
    const sourceKey = string(value["sourceKey"], "Source key");
    const partition = string(value["partition"], "Source partition");
    const id = `${sourceKey}:${partition}`;
    return entity("source_state", id, { ...value, id });
  }
  if (row.table === "source_run_records") {
    const runId = string(value["runId"], "Source run ID");
    const sourceRecordId = string(value["sourceRecordId"], "Source record ID");
    const id = `${runId}:${sourceRecordId}`;
    return entity("source_run_record", id, {
      id,
      runId,
      sourceRecordId,
      createdAt: value["observedAt"],
    });
  }
  if (row.table === "job_source_links") {
    const jobId = string(value["jobId"], "Job source link job ID");
    const sourceKey = string(value["sourceKey"], "Job source link source key");
    const partition = string(value["partition"], "Job source link partition");
    const externalId = string(value["externalId"], "Job source link external ID");
    const id = `${jobId}:${sourceKey}:${partition}:${externalId}`;
    return entity("job_source_link", id, {
      ...value,
      id,
      attributionRequired: boolean(value["attributionRequired"]),
      followedLinkRequired: boolean(value["followedLinkRequired"]),
    });
  }
  const kind = directKinds[row.table];
  if (kind === undefined) return null;
  const id = string(value["id"], `${row.table} ID`);
  const body: Record<string, unknown> = { ...value };
  if (row.table === "application_delegation_records") {
    body["agentSessionId"] = body["agentId"];
    delete body["agentId"];
  }
  if (row.table === "audit_events") delete body["sequence"];
  for (const key of [
    "verified",
    "enabled",
    "notModified",
    "complete",
    "attributionRequired",
    "followedLinkRequired",
  ] as const) {
    if (key in body && body[key] !== null) body[key] = boolean(body[key]);
  }
  const imported = entity(kind, id, body);
  return row.table === "owners" ? { ...imported, ownerId: id } : imported;
}

function rowsFor(rows: readonly SnapshotRow[], table: string): readonly SnapshotRow[] {
  return rows.filter((row) => row.table === table);
}

function sourceEvidenceEntities(rows: readonly SnapshotRow[]): ImportedEntity[] {
  const payloads = new Map(
    rowsFor(rows, "source_payloads").map((row) => [
      string(row.data["source_record_id"], "Source payload record ID"),
      camelizeRow(row.data),
    ]),
  );
  const normalizationRows = rowsFor(rows, "normalization_results").map((row) =>
    camelizeRow(row.data),
  );
  return rowsFor(rows, "source_records").map((row) => {
    const value = camelizeRow(row.data);
    const id = string(value["id"], "Source evidence ID");
    const payload = payloads.get(id);
    const normalizations = normalizationRows
      .filter((item) => item["sourceRecordId"] === id)
      .sort(
        (left, right) =>
          integer(right["normalizerVersion"], "Normalizer version", 1) -
            integer(left["normalizerVersion"], "Normalizer version", 1) ||
          timestamp(right["recordedAt"]).localeCompare(timestamp(left["recordedAt"])),
      );
    const normalization = normalizations[0];
    const firstFetchedAt = string(value["firstFetchedAt"], "Source first-fetched timestamp");
    return entity("source_evidence", id, {
      id,
      sourceKey: value["sourceKey"],
      partition: value["partition"],
      externalId: value["externalId"],
      originalUrl: value["originalUrl"],
      applyUrl: value["applyUrl"],
      sourceUpdatedAt: value["sourceUpdatedAt"],
      fetchedAt: firstFetchedAt,
      firstFetchedAt,
      retainedUntil: payload?.["retainedUntil"] ?? firstFetchedAt,
      rawHash: value["rawHash"],
      payload: payload?.["payload"] ?? null,
      policyVersion: value["policyVersion"],
      attribution: {
        label: value["attributionLabel"],
        url: value["attributionUrl"],
        required: boolean(value["attributionRequired"]),
        followedLinkRequired: boolean(value["followedLinkRequired"]),
      },
      normalization:
        normalization === undefined
          ? null
          : {
              status: normalization["status"],
              reason: normalization["reason"],
              issues: normalization["issues"],
              normalizerVersion: normalization["normalizerVersion"],
              normalizedHash: normalization["normalizedHash"],
              recordedAt: normalization["recordedAt"],
            },
    });
  });
}

function alertEvaluationEntities(rows: readonly SnapshotRow[]): ImportedEntity[] {
  const baselines = rowsFor(rows, "alert_evaluation_baselines").map((row) => camelizeRow(row.data));
  return rowsFor(rows, "alert_evaluations").map((row) => {
    const value = camelizeRow(row.data);
    const id = string(value["id"], "Alert evaluation ID");
    const baseline = baselines
      .filter((item) => item["evaluationId"] === id)
      .map((item) => ({ jobId: item["jobId"], fingerprint: item["fingerprint"] }))
      .sort((left, right) => String(left.jobId).localeCompare(String(right.jobId)));
    return entity("alert_evaluation", id, { ...value, baseline });
  });
}

function ownerActivities(rows: readonly SnapshotRow[]): ImportedOwnerActivity[] {
  return rowsFor(rows, "owner_activity_events")
    .map((row) => {
      const value = camelizeRow(row.data);
      const effects = value["effects"];
      if (!Array.isArray(effects)) throw new Error("Owner activity effects must be an array.");
      return {
        sequence: integer(value["sequence"], "Owner activity sequence", 1),
        id: string(value["id"], "Owner activity ID"),
        ownerId: string(value["ownerId"], "Owner activity owner ID"),
        schemaVersion: integer(value["schemaVersion"], "Owner activity schema version", 1),
        kind: string(value["kind"], "Owner activity kind"),
        activityKey: string(value["activityKey"], "Owner activity key"),
        status: string(value["status"], "Owner activity status"),
        safeSummary: string(value["safeSummary"], "Owner activity summary"),
        correlationId: string(value["correlationId"], "Owner activity correlation ID"),
        actorKind: string(value["actorKind"], "Owner activity actor kind"),
        aggregateType: string(value["aggregateType"], "Owner activity aggregate type"),
        aggregateVersion: integer(value["aggregateVersion"], "Owner activity aggregate version"),
        occurredAt: string(value["occurredAt"], "Owner activity timestamp"),
        effects,
      };
    })
    .sort((left, right) => left.sequence - right.sequence);
}

function rateLimitWindows(rows: readonly SnapshotRow[]): ImportedRateLimitWindow[] {
  return rowsFor(rows, "rate_limit_windows")
    .map((row) => ({
      key: string(row.data["key"], "Rate-limit key"),
      count: integer(row.data["count"], "Rate-limit count"),
      resetAtMs: integer(row.data["reset_at_ms"], "Rate-limit reset timestamp"),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function buildSnapshotImportPlan(rows: readonly SnapshotRow[]): SnapshotImportPlan {
  const mappedEntities = [
    ...rows.map(directEntity).filter((item): item is ImportedEntity => item !== null),
    ...alertEvaluationEntities(rows),
    ...sourceEvidenceEntities(rows),
  ];
  const evaluationOwners = new Map(
    mappedEntities
      .filter((item) => item.kind === "alert_evaluation" && item.ownerId !== null)
      .map((item) => [item.id, item.ownerId] as const),
  );
  const entities = mappedEntities
    .map((item) => {
      if (item.kind !== "alert_change") return item;
      const evaluationId = item.body["evaluationId"];
      return typeof evaluationId === "string"
        ? { ...item, ownerId: evaluationOwners.get(evaluationId) ?? null }
        : item;
    })
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const identities = new Set<string>();
  const entityCounts: Record<string, number> = {};
  for (const item of entities) {
    const identity = `${item.kind}\u0000${item.id}`;
    if (identities.has(identity))
      throw new Error(`Snapshot maps more than one row to ${item.kind}/${item.id}.`);
    identities.add(identity);
    entityCounts[item.kind] = (entityCounts[item.kind] ?? 0) + 1;
  }
  const stagedOnlyTables = [
    ...new Set(
      rows
        .filter(
          (row) =>
            SNAPSHOT_TABLE_MODES[row.table as keyof typeof SNAPSHOT_TABLE_MODES] === "staged_only",
        )
        .map((row) => row.table),
    ),
  ].sort();
  return {
    entities,
    ownerActivities: ownerActivities(rows),
    rateLimitWindows: rateLimitWindows(rows),
    stagedOnlyTables,
    entityCounts,
  };
}

export function assertSnapshotImportable(plan: SnapshotImportPlan): void {
  if (plan.stagedOnlyTables.length > 0) {
    throw new Error(
      "Snapshot contains rows in staged-only legacy tables. Migrate or remove that superseded state before cutover.",
    );
  }
}

export async function importPostgresSnapshot(
  databaseUrl: string,
  snapshotPath: string,
): Promise<ImportedSnapshot> {
  const { manifest, rows } = parseSnapshot(await readFile(snapshotPath, "utf8"));
  const plan = buildSnapshotImportPlan(rows);
  assertSnapshotImportable(plan);
  const sql = openPostgresDatabase(databaseUrl);
  const snapshotId = `snapshot_${randomUUID()}`;
  try {
    await migratePostgres(sql);
    await sql.begin(async (transaction) => {
      await transaction`INSERT INTO jobbbler.migration_snapshots(id, format_version, checksum, row_count, status) VALUES (${snapshotId}, ${manifest.formatVersion}, ${manifest.checksum}, ${manifest.rowCount}, 'importing')`;
      for (const [ordinal, row] of rows.entries()) {
        const rowId = typeof row.data["id"] === "string" ? row.data["id"] : null;
        await transaction`INSERT INTO jobbbler.migration_rows(snapshot_id, ordinal, table_name, row_id, payload) VALUES (${snapshotId}, ${ordinal}, ${row.table}, ${rowId}, ${transaction.json(jsonValue(row.data))})`;
      }
      for (const imported of plan.entities) {
        await transaction`SELECT jobbbler.import_snapshot_row(${snapshotId}, ${imported.kind}, ${imported.id}, ${imported.ownerId}, ${transaction.json(jsonValue(imported.body))}, ${imported.version}, ${imported.createdAt}, ${imported.updatedAt})`;
      }
      for (const window of plan.rateLimitWindows) {
        await transaction`INSERT INTO jobbbler.rate_limit_windows(key, count, reset_at_ms) VALUES (${window.key}, ${window.count}, ${window.resetAtMs}) ON CONFLICT(key) DO UPDATE SET count = EXCLUDED.count, reset_at_ms = EXCLUDED.reset_at_ms`;
      }
      for (const activity of plan.ownerActivities) {
        await transaction`INSERT INTO jobbbler.owner_activity_events(sequence, id, owner_id, schema_version, kind, activity_key, status, safe_summary, correlation_id, actor_kind, aggregate_type, aggregate_version, occurred_at, effects)
          VALUES (${activity.sequence}, ${activity.id}, ${activity.ownerId}, ${activity.schemaVersion}, ${activity.kind}, ${activity.activityKey}, ${activity.status}, ${activity.safeSummary}, ${activity.correlationId}, ${activity.actorKind}, ${activity.aggregateType}, ${activity.aggregateVersion}, ${activity.occurredAt}, ${transaction.json(jsonValue(activity.effects))})
          ON CONFLICT(id) DO UPDATE SET sequence = EXCLUDED.sequence, owner_id = EXCLUDED.owner_id, schema_version = EXCLUDED.schema_version, kind = EXCLUDED.kind, activity_key = EXCLUDED.activity_key, status = EXCLUDED.status, safe_summary = EXCLUDED.safe_summary, correlation_id = EXCLUDED.correlation_id, actor_kind = EXCLUDED.actor_kind, aggregate_type = EXCLUDED.aggregate_type, aggregate_version = EXCLUDED.aggregate_version, occurred_at = EXCLUDED.occurred_at, effects = EXCLUDED.effects`;
      }
      if (plan.ownerActivities.length > 0)
        await transaction.unsafe(
          "SELECT setval(pg_get_serial_sequence('jobbbler.owner_activity_events', 'sequence'), (SELECT max(sequence) FROM jobbbler.owner_activity_events), true)",
        );
      await transaction`UPDATE jobbbler.migration_snapshots SET status = 'imported', completed_at = now() WHERE id = ${snapshotId}`;
    });
    return {
      snapshotId,
      checksum: manifest.checksum,
      rowCount: manifest.rowCount,
      entityCount: plan.entities.length,
      ownerActivityCount: plan.ownerActivities.length,
    };
  } catch (error) {
    try {
      await sql`UPDATE jobbbler.migration_snapshots SET status = 'failed', completed_at = now() WHERE id = ${snapshotId}`;
    } catch {
      /* The migration schema or transaction may not exist after an early failure. */
    }
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined) throw new Error("DATABASE_URL is required for PostgreSQL import.");
  importPostgresSnapshot(
    databaseUrl,
    resolve(process.argv[2] ?? "var/jobbbler-export.ndjson"),
  ).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`));
}
