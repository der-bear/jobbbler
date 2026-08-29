import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openPostgresDatabase } from "../packages/storage-postgres/src/connection.js";
import type { SnapshotManifest } from "./export-sqlite.js";
import {
  assertSnapshotImportable,
  buildSnapshotImportPlan,
  parseSnapshot,
  type ImportedEntity,
  type ImportedOwnerActivity,
  type ImportedRateLimitWindow,
  type SnapshotImportPlan,
} from "./import-postgres.js";

interface SnapshotEvidence {
  readonly formatVersion: number;
  readonly checksum: string;
  readonly rowCount: number;
  readonly status: string;
}

interface RepresentativeOwnerEvidence {
  readonly ownerId: string;
  readonly entityIdentities: readonly string[];
  readonly activityIds: readonly string[];
}

export interface PostgresSnapshotEvidence {
  readonly snapshot: SnapshotEvidence;
  readonly stagedCounts: Readonly<Record<string, number>>;
  readonly entities: readonly ImportedEntity[];
  readonly ownerActivities: readonly ImportedOwnerActivity[];
  readonly rateLimitWindows: readonly ImportedRateLimitWindow[];
  readonly searchDocumentJobIds: readonly string[];
  readonly representativeSearchMatched: boolean;
  readonly representativeOwner: RepresentativeOwnerEvidence | null;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
}

function entityIdentity(entity: Pick<ImportedEntity, "kind" | "id">): string {
  return `${entity.kind}\u0000${entity.id}`;
}

function comparableEntity(entity: ImportedEntity): unknown {
  return {
    kind: entity.kind,
    id: entity.id,
    ownerId: entity.ownerId,
    body: entity.body,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function sorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

export function assertPostgresSnapshotEvidence(
  manifest: SnapshotManifest,
  plan: SnapshotImportPlan,
  evidence: PostgresSnapshotEvidence,
): void {
  if (
    evidence.snapshot.status !== "imported" ||
    evidence.snapshot.formatVersion !== manifest.formatVersion ||
    evidence.snapshot.checksum !== manifest.checksum ||
    evidence.snapshot.rowCount !== manifest.rowCount
  )
    throw new Error("PostgreSQL snapshot manifest does not match the local export.");
  if (stable(evidence.stagedCounts) !== stable(manifest.tables))
    throw new Error("PostgreSQL staging table counts do not match the local export.");

  const expectedEntities = sorted(plan.entities, entityIdentity);
  const actualEntities = sorted(evidence.entities, entityIdentity);
  if (stable(actualEntities.map(entityIdentity)) !== stable(expectedEntities.map(entityIdentity)))
    throw new Error("Imported PostgreSQL entity identities do not match the migration plan.");
  if (
    stable(actualEntities.map(comparableEntity)) !== stable(expectedEntities.map(comparableEntity))
  )
    throw new Error("Imported PostgreSQL entity records do not match the migration plan.");

  const expectedActivities = sorted(
    plan.ownerActivities,
    (item) => `${String(item.sequence).padStart(20, "0")}:${item.id}`,
  );
  const actualActivities = sorted(
    evidence.ownerActivities,
    (item) => `${String(item.sequence).padStart(20, "0")}:${item.id}`,
  );
  if (stable(actualActivities) !== stable(expectedActivities))
    throw new Error("Imported PostgreSQL owner activity does not match the migration plan.");
  if (
    stable(sorted(evidence.rateLimitWindows, (item) => item.key)) !==
    stable(sorted(plan.rateLimitWindows, (item) => item.key))
  )
    throw new Error("Imported PostgreSQL rate-limit state does not match the migration plan.");

  const expectedJobIds = plan.entities
    .filter((item) => item.kind === "job")
    .map((item) => item.id)
    .sort();
  if (stable([...evidence.searchDocumentJobIds].sort()) !== stable(expectedJobIds))
    throw new Error("Imported PostgreSQL search documents do not cover the migrated catalog.");
  if (expectedJobIds.length > 0 && !evidence.representativeSearchMatched)
    throw new Error("Representative PostgreSQL catalog search did not resolve its migrated job.");

  const representativeOwner = plan.entities.find((item) => item.kind === "owner");
  if (representativeOwner !== undefined) {
    const expectedEntityIdentities = plan.entities
      .filter((item) => item.ownerId === representativeOwner.id)
      .map(entityIdentity)
      .sort();
    const expectedActivityIds = plan.ownerActivities
      .filter((item) => item.ownerId === representativeOwner.id)
      .map((item) => item.id)
      .sort();
    if (
      evidence.representativeOwner?.ownerId !== representativeOwner.id ||
      stable([...evidence.representativeOwner.entityIdentities].sort()) !==
        stable(expectedEntityIdentities) ||
      stable([...evidence.representativeOwner.activityIds].sort()) !== stable(expectedActivityIds)
    )
      throw new Error("Representative owner-private continuity check failed.");
  }
}

interface SnapshotRow {
  readonly format_version: number;
  readonly checksum: string;
  readonly row_count: number;
  readonly status: string;
}

interface EntityRow {
  readonly kind: string;
  readonly id: string;
  readonly owner_id: string | null;
  readonly body: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ActivityRow {
  readonly sequence: string;
  readonly id: string;
  readonly owner_id: string;
  readonly schema_version: number;
  readonly kind: string;
  readonly activity_key: string;
  readonly status: string;
  readonly safe_summary: string;
  readonly correlation_id: string;
  readonly actor_kind: string;
  readonly aggregate_type: string;
  readonly aggregate_version: number;
  readonly occurred_at: string;
  readonly effects: readonly unknown[];
}

function activityFromRow(row: ActivityRow): ImportedOwnerActivity {
  const sequence = Number(row.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new Error("PostgreSQL owner activity sequence is invalid.");
  return {
    sequence,
    id: row.id,
    ownerId: row.owner_id,
    schemaVersion: row.schema_version,
    kind: row.kind,
    activityKey: row.activity_key,
    status: row.status,
    safeSummary: row.safe_summary,
    correlationId: row.correlation_id,
    actorKind: row.actor_kind,
    aggregateType: row.aggregate_type,
    aggregateVersion: row.aggregate_version,
    occurredAt: row.occurred_at,
    effects: row.effects,
  };
}

function representativeSearchTerm(
  plan: SnapshotImportPlan,
): { readonly jobId: string; readonly term: string } | null {
  const job = plan.entities.find((item) => item.kind === "job");
  if (job === undefined) return null;
  const title = typeof job.body["title"] === "string" ? job.body["title"] : "";
  const term = title.match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/u)?.[0];
  if (term === undefined)
    throw new Error("Representative migrated job has no searchable title term.");
  return { jobId: job.id, term };
}

export async function verifyPostgresSnapshot(
  databaseUrl: string,
  snapshotPath: string,
  snapshotId: string,
): Promise<void> {
  const { manifest, rows } = parseSnapshot(await readFile(snapshotPath, "utf8"));
  const plan = buildSnapshotImportPlan(rows);
  assertSnapshotImportable(plan);
  const sql = openPostgresDatabase(databaseUrl);
  try {
    const snapshotRows = await sql<
      SnapshotRow[]
    >`SELECT format_version, checksum, row_count, status FROM jobbbler.migration_snapshots WHERE id = ${snapshotId}`;
    const snapshot = snapshotRows[0];
    if (snapshot === undefined) throw new Error("PostgreSQL migration snapshot was not found.");

    const countRows = await sql<
      { readonly table_name: string; readonly count: string }[]
    >`SELECT table_name, count(*)::text AS count FROM jobbbler.migration_rows WHERE snapshot_id = ${snapshotId} GROUP BY table_name`;
    const stagedCounts: Record<string, number> = Object.fromEntries(
      Object.keys(manifest.tables).map((table) => [table, 0]),
    );
    for (const item of countRows) stagedCounts[item.table_name] = Number(item.count);

    const expectedEntityIdentities = new Set(plan.entities.map(entityIdentity));
    const kinds = Object.keys(plan.entityCounts);
    const databaseEntities =
      kinds.length === 0
        ? []
        : await sql<EntityRow[]>`
      SELECT kind, id, owner_id, body, version,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
             to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
      FROM jobbbler.entity_records WHERE kind = ANY(${sql.array(kinds)})`;
    const entities: ImportedEntity[] = databaseEntities
      .filter((item) => expectedEntityIdentities.has(`${item.kind}\u0000${item.id}`))
      .map((item) => ({
        kind: item.kind,
        id: item.id,
        ownerId: item.owner_id,
        body: item.body,
        version: item.version,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }));

    const activityIds = plan.ownerActivities.map((item) => item.id);
    const activityRows =
      activityIds.length === 0
        ? []
        : await sql<ActivityRow[]>`
      SELECT sequence::text, id, owner_id, schema_version, kind, activity_key, status, safe_summary,
             correlation_id, actor_kind, aggregate_type, aggregate_version,
             to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at, effects
      FROM jobbbler.owner_activity_events WHERE id = ANY(${sql.array(activityIds)})`;
    const ownerActivityRows = activityRows.map(activityFromRow);

    const rateKeys = plan.rateLimitWindows.map((item) => item.key);
    const rateRows =
      rateKeys.length === 0
        ? []
        : await sql<
            { readonly key: string; readonly count: number; readonly reset_at_ms: string }[]
          >`
      SELECT key, count, reset_at_ms::text FROM jobbbler.rate_limit_windows WHERE key = ANY(${sql.array(rateKeys)})`;
    const rateLimitWindows = rateRows.map((item) => ({
      key: item.key,
      count: item.count,
      resetAtMs: Number(item.reset_at_ms),
    }));

    const expectedJobIds = plan.entities
      .filter((item) => item.kind === "job")
      .map((item) => item.id);
    const documentRows =
      expectedJobIds.length === 0
        ? []
        : await sql<{ readonly job_id: string }[]>`
      SELECT job_id FROM jobbbler.job_search_documents WHERE job_id = ANY(${sql.array(expectedJobIds)})`;
    const representative = representativeSearchTerm(plan);
    const representativeRows =
      representative === null
        ? []
        : await sql<{ readonly job_id: string }[]>`
      SELECT job_id FROM jobbbler.job_search_documents
      WHERE job_id = ${representative.jobId} AND document @@ plainto_tsquery('simple', ${representative.term})`;

    const representativeOwnerEntity = plan.entities.find((item) => item.kind === "owner");
    const representativeOwner =
      representativeOwnerEntity === undefined
        ? null
        : {
            ownerId: representativeOwnerEntity.id,
            entityIdentities: entities
              .filter((item) => item.ownerId === representativeOwnerEntity.id)
              .map(entityIdentity),
            activityIds: ownerActivityRows
              .filter((item) => item.ownerId === representativeOwnerEntity.id)
              .map((item) => item.id),
          };

    assertPostgresSnapshotEvidence(manifest, plan, {
      snapshot: {
        formatVersion: snapshot.format_version,
        checksum: snapshot.checksum,
        rowCount: snapshot.row_count,
        status: snapshot.status,
      },
      stagedCounts,
      entities,
      ownerActivities: ownerActivityRows,
      rateLimitWindows,
      searchDocumentJobIds: documentRows.map((item) => item.job_id),
      representativeSearchMatched:
        representative === null ||
        representativeRows.some((item) => item.job_id === representative.jobId),
      representativeOwner,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  const databaseUrl = process.env["DATABASE_URL"];
  const snapshotId = process.argv[3];
  if (databaseUrl === undefined || snapshotId === undefined)
    throw new Error("DATABASE_URL and snapshot ID are required.");
  verifyPostgresSnapshot(
    databaseUrl,
    resolve(process.argv[2] ?? "var/jobbbler-export.ndjson"),
    snapshotId,
  ).then(() => process.stdout.write("verified\n"));
}
