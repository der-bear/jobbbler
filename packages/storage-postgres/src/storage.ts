import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type postgres from "postgres";

import {
  DomainError,
  type ConsumeOwnerRecoveryResult,
  type ConsumeVerificationResult,
  type IdentityStore,
  type OwnerDeletionIntentRecord,
  type OwnerIdentityRecord,
  type OwnerRecoveryChallengeRecord,
  type OwnerSessionRecord,
  type ResolvedOwnerSession,
  type VerificationChallengeRecord,
  type VerificationEndpointRecord,
} from "@jobbbler/core-domain";
import { ownerActivityEventSchema, requiresAgentClientSubmissionDecision } from "@jobbbler/storage";
import type {
  AlertChangeRecord,
  AlertDeliveryRecord,
  AlertDeliveryUpdate,
  AlertEvaluationRecord,
  ApplicationConfirmationRecord,
  ApplicationReceiptRecord,
  ApplicationReviewRecord,
  ManagedApplicationDeliveryRecord,
  AuditEventRecord,
  ClaimWorkItemsInput,
  DataGrantRecord,
  IdempotencyRecord,
  JobSourceLinkRecord,
  JobVersionRecord,
  OrganizationRecord,
  OwnerRecord,
  PersistSourceObservationInput,
  PersistSourceObservationResult,
  RateLimitCheckInput,
  RateLimitDecision,
  SavedSearchRecord,
  SearchAlertActivationInput,
  SearchAlertActivationResult,
  SearchAlertPreparationSagaBody,
  SearchAlertPreparationSagaRecord,
  ScheduleRecord,
  SourceRunRecord,
  SourceStateInput,
  SourceStateRecord,
  SourceReconciliationResult,
  StoredSourceEvidence,
  Storage,
  WorkItemRecord,
  AgentDelegationRecord,
  ApplicationDraft,
  Job,
  AgentSessionRecord,
  ResolveAgentSessionInput,
  RichDataGrantRecord,
  RichDataGrantMatchInput,
  ActiveDelegationMatchInput,
  ApproveRichDataGrantInput,
  MaterialApplicationEditInput,
  SealApplicationReviewInput,
  CompleteApplicationSubmissionInput,
  CompleteApplicationSubmissionResult,
  OwnerActivityEventRecord,
} from "@jobbbler/storage";

import { openPostgresDatabase, type PostgresExecutor, type PostgresSql } from "./connection.js";
import { searchPostgresJobs } from "./job-search.js";

interface EntityRow {
  readonly id: string;
  readonly owner_id: string | null;
  readonly body: unknown;
  readonly version: number;
}

interface OwnerActivityRow {
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
  readonly effects: unknown;
}

export type PostgresStorage = Omit<Storage, "close"> & {
  readonly sql: PostgresSql;
  close(): Promise<void>;
};

function domain(
  code: "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION",
  message: string,
): DomainError {
  return new DomainError({ code, message });
}

function body<T>(row: EntityRow): T {
  if (typeof row.body !== "object" || row.body === null || Array.isArray(row.body)) {
    throw domain("VALIDATION", "Stored PostgreSQL record body is invalid.");
  }
  return row.body as T;
}

function ownerActivityFromRow(row: OwnerActivityRow): OwnerActivityEventRecord {
  const sequence = Number(row.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw domain("VALIDATION", "Stored activity cursor sequence is invalid.");
  }
  return {
    sequence,
    ownerId: row.owner_id,
    event: ownerActivityEventSchema.parse({
      id: row.id,
      schemaVersion: row.schema_version,
      kind: row.kind,
      key: row.activity_key,
      status: row.status,
      safeSummary: row.safe_summary,
      correlationId: row.correlation_id,
      actorKind: row.actor_kind,
      aggregate: { type: row.aggregate_type, version: row.aggregate_version },
      occurredAt: row.occurred_at,
      effects: row.effects,
    }),
  };
}

function timestamp(value: unknown): string {
  return typeof value === "string" ? value : new Date().toISOString();
}

function ownerOf(record: object): string | null {
  const ownerId = (record as { readonly ownerId?: unknown }).ownerId;
  return typeof ownerId === "string" ? ownerId : null;
}

async function get<T>(sql: PostgresExecutor, kind: string, id: string): Promise<T | null> {
  const rows = await sql<EntityRow[]>`
    SELECT id, owner_id, body, version FROM jobbbler.entity_records
    WHERE kind = ${kind} AND id = ${id}`;
  return rows[0] === undefined ? null : body<T>(rows[0]);
}

async function getForUpdate<T>(sql: PostgresExecutor, kind: string, id: string): Promise<T | null> {
  const rows = await sql<
    EntityRow[]
  >`SELECT id, owner_id, body, version FROM jobbbler.entity_records WHERE kind = ${kind} AND id = ${id} FOR UPDATE`;
  return rows[0] === undefined ? null : body<T>(rows[0]);
}

async function list<T>(sql: PostgresExecutor, kind: string, ownerId?: string): Promise<T[]> {
  const rows =
    ownerId === undefined
      ? await sql<
          EntityRow[]
        >`SELECT id, owner_id, body, version FROM jobbbler.entity_records WHERE kind = ${kind} ORDER BY updated_at DESC, id`
      : await sql<
          EntityRow[]
        >`SELECT id, owner_id, body, version FROM jobbbler.entity_records WHERE kind = ${kind} AND owner_id = ${ownerId} ORDER BY updated_at DESC, id`;
  return rows.map(body<T>);
}

async function deletePendingOrphanVerificationEndpoint(
  sql: PostgresExecutor,
  ownerId: string,
  endpointId: string,
): Promise<void> {
  const endpoint = await getForUpdate<VerificationEndpointRecord>(
    sql,
    "verification_endpoint",
    endpointId,
  );
  if (endpoint?.ownerId !== ownerId || endpoint.status !== "pending") return;
  const references = await sql<{ readonly referenced: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM jobbbler.entity_records
      WHERE owner_id = ${ownerId}
        AND (
          (kind IN ('verification_challenge', 'owner_recovery_challenge')
            AND body->>'endpointId' = ${endpointId})
          OR
          (kind = 'schedule' AND body->>'deliveryEndpointId' = ${endpointId})
        )
    ) AS referenced`;
  if (references[0]?.referenced === true) return;
  await sql`
    DELETE FROM jobbbler.entity_records
    WHERE kind = 'verification_endpoint' AND id = ${endpointId} AND owner_id = ${ownerId}`;
}

export async function findOwnerSessionByTokenHash(
  sql: PostgresExecutor,
  tokenHash: string,
): Promise<OwnerSessionRecord | null> {
  const rows = await sql<EntityRow[]>`
    SELECT id, owner_id, body, version
    FROM jobbbler.entity_records
    WHERE kind = 'owner_session'
      AND body->>'tokenHash' = ${tokenHash}
    LIMIT 1`;
  return rows[0] === undefined ? null : body<OwnerSessionRecord>(rows[0]);
}

async function listByOwnerDraft<T>(
  sql: PostgresExecutor,
  kind: "delegation" | "rich_data_grant",
  ownerId: string,
  draftField: "resourceId" | "draftId",
  draftId: string,
): Promise<T[]> {
  const rows = await sql<EntityRow[]>`
    SELECT id, owner_id, body, version
    FROM jobbbler.entity_records
    WHERE kind = ${kind}
      AND owner_id = ${ownerId}
      AND body->>${draftField} = ${draftId}
    ORDER BY created_at DESC, id DESC`;
  return rows.map(body<T>);
}

async function write<T extends { readonly id: string }>(
  sql: PostgresExecutor,
  kind: string,
  record: T,
  ownerId = ownerOf(record),
  version = (record as { readonly version?: number }).version ?? 0,
): Promise<T> {
  await sql`
    INSERT INTO jobbbler.entity_records(kind, id, owner_id, body, version, created_at, updated_at)
    VALUES (${kind}, ${record.id}, ${ownerId}, ${sql.json(record)}, ${version},
            ${timestamp((record as { readonly createdAt?: unknown }).createdAt)},
            ${timestamp((record as { readonly updatedAt?: unknown }).updatedAt)})
    ON CONFLICT (kind, id) DO UPDATE SET
      owner_id = EXCLUDED.owner_id, body = EXCLUDED.body, version = EXCLUDED.version,
      created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`;
  return record;
}

async function upsertJob(sql: PostgresExecutor, record: Job): Promise<Job> {
  const rows = await sql<EntityRow[]>`
    INSERT INTO jobbbler.entity_records AS existing
      (kind, id, owner_id, body, version, created_at, updated_at)
    VALUES ('job', ${record.id}, NULL, ${sql.json(record)}, 0,
            ${timestamp(undefined)}, ${timestamp(record.updatedAt)})
    ON CONFLICT (kind, id) DO UPDATE SET
      owner_id = EXCLUDED.owner_id,
      body = EXCLUDED.body,
      version = EXCLUDED.version,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at
    WHERE existing.body->>'applyMode' = EXCLUDED.body->>'applyMode'
    RETURNING id, owner_id, body, version`;
  if (rows[0] === undefined) {
    throw domain("CONFLICT", "A job's application mode cannot change after creation.");
  }
  return body<Job>(rows[0]);
}

async function insert<T extends { readonly id: string }>(
  sql: PostgresExecutor,
  kind: string,
  record: T,
  ownerId = ownerOf(record),
): Promise<T> {
  const existing = await get<T>(sql, kind, record.id);
  if (existing !== null) throw domain("CONFLICT", `${kind} already exists.`);
  return write(sql, kind, record, ownerId);
}

async function updateVersioned<T extends { readonly id: string; readonly version: number }>(
  sql: PostgresExecutor,
  kind: string,
  record: T,
  expectedVersion: number,
): Promise<T> {
  const stored = { ...record, version: expectedVersion + 1 } as T;
  const rows = await sql<EntityRow[]>`
    UPDATE jobbbler.entity_records
    SET owner_id = ${ownerOf(stored)},
        body = ${sql.json(stored)},
        version = ${stored.version},
        updated_at = ${timestamp((stored as { readonly updatedAt?: unknown }).updatedAt)}
    WHERE kind = ${kind} AND id = ${stored.id} AND version = ${expectedVersion}
    RETURNING id, owner_id, body, version`;
  if (rows[0] !== undefined) return body<T>(rows[0]);
  const existing = await get<T>(sql, kind, stored.id);
  if (existing === null) throw domain("NOT_FOUND", `${kind} was not found.`);
  throw domain("CONFLICT", `${kind} changed after it was read. Refresh and retry.`);
}

async function requireWorkItemMutation(
  sql: PostgresExecutor,
  id: string,
  rows: readonly EntityRow[],
): Promise<WorkItemRecord> {
  const updated = rows[0];
  if (updated !== undefined) return body<WorkItemRecord>(updated);
  const existing = await sql<{ readonly present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM jobbbler.entity_records WHERE kind = 'work_item' AND id = ${id}
    ) AS present`;
  if (existing[0]?.present !== true) throw domain("NOT_FOUND", "Work item was not found.");
  throw domain("CONFLICT", "Work item is not held by this worker under an active lease.");
}

async function assertDraftOwnership(
  sql: PostgresExecutor,
  ownerId: string,
  draftId: string,
): Promise<void> {
  const draft = await get<ApplicationDraft>(sql, "application", draftId);
  if (draft?.ownerId !== ownerId) {
    throw domain(
      "VALIDATION",
      "Authorization record must bind an application draft owned by its owner.",
    );
  }
}

function assertTokenHash(tokenHash: string): void {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) {
    throw domain("VALIDATION", "Agent session token hash must be a lowercase SHA-256 digest.");
  }
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameRichDataGrantScope(left: RichDataGrantRecord, right: RichDataGrantRecord): boolean {
  return (
    left.ownerId === right.ownerId &&
    left.draftId === right.draftId &&
    left.recipientId === right.recipientId &&
    left.purpose === right.purpose &&
    left.payloadHash === right.payloadHash &&
    left.noticeVersion === right.noticeVersion &&
    left.legalBasis === right.legalBasis &&
    stableHash(left.categories) === stableHash(right.categories) &&
    stableHash(left.fieldKeys) === stableHash(right.fieldKeys) &&
    stableHash(left.documentIds) === stableHash(right.documentIds)
  );
}

function ensureUnique<T>(items: readonly T[], key: (item: T) => string, label: string): void {
  const values = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (values.has(value)) throw new TypeError(`${label} values must be unique.`);
    values.add(value);
  }
}

function validateKinds(kinds: ClaimWorkItemsInput["kinds"]): readonly string[] {
  if (kinds === undefined) return [];
  if (!Array.isArray(kinds) || kinds.length === 0 || kinds.length > 16) {
    throw domain("VALIDATION", "Work-item kinds must contain between 1 and 16 values.");
  }
  const unique = new Set<string>();
  for (const kind of kinds) {
    if (
      typeof kind !== "string" ||
      kind.trim().length === 0 ||
      kind.length > 128 ||
      unique.has(kind)
    ) {
      throw domain("VALIDATION", "Work-item kinds must be unique non-empty values.");
    }
    unique.add(kind);
  }
  return [...unique];
}

interface SearchAlertReviewEvidenceBody {
  readonly purpose: "search_alert_activation";
  readonly ownerId: string;
  readonly requestId: string;
  readonly savedSearchId: string;
  readonly savedSearchVersion: number;
  readonly criteria: unknown;
  readonly endpointId: string;
  readonly challengeId: string;
  readonly scheduleId: string;
  readonly recurrence: ScheduleRecord["recurrence"];
  readonly firstRunAt: string;
  readonly privacyNoticeVersion: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

interface SearchAlertDecisionIntentBody {
  readonly version: 1;
  readonly status: "deciding";
  readonly requestId: string;
  readonly reviewBinding: string;
  readonly decision: "approved" | "declined";
  readonly recordedAt: string;
}

const searchAlertDecisionIntentMaximumLifetimeMs = 24 * 60 * 60 * 1_000;

function searchAlertConflict(message: string): never {
  throw domain("CONFLICT", message);
}

function searchAlertTimestampMs(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return searchAlertConflict(`The search-alert ${label} timestamp is invalid.`);
  }
  return parsed;
}

function searchAlertObjectBody(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return searchAlertConflict(`The search-alert ${label} envelope is invalid.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function idempotencyFromEntity(row: EntityRow): IdempotencyRecord {
  const stored = body<IdempotencyRecord & { readonly id: string }>(row);
  const { id: _id, ...record } = stored;
  return record;
}

async function getIdempotencyForUpdate(
  sql: PostgresExecutor,
  scope: string,
  key: string,
): Promise<IdempotencyRecord | null> {
  const rows = await sql<EntityRow[]>`
    SELECT id, owner_id, body, version
    FROM jobbbler.entity_records
    WHERE kind = 'idempotency' AND id = ${`${scope}:${key}`}
    FOR UPDATE`;
  return rows[0] === undefined ? null : idempotencyFromEntity(rows[0]);
}

async function putExactIdempotencyRecord(
  sql: PostgresExecutor,
  record: IdempotencyRecord,
): Promise<{ readonly inserted: boolean; readonly record: IdempotencyRecord }> {
  const current = await getIdempotencyForUpdate(sql, record.scope, record.key);
  if (current !== null) {
    if (!isDeepStrictEqual(current, record)) {
      return searchAlertConflict(
        "The search-alert lifecycle record is already bound to a different envelope.",
      );
    }
    return { inserted: false, record: current };
  }
  const id = `${record.scope}:${record.key}`;
  const candidate = { ...record, id };
  await sql`
    INSERT INTO jobbbler.entity_records(
      kind, id, owner_id, body, version, created_at, updated_at
    ) VALUES (
      'idempotency', ${id}, NULL,
      ${sql.json(candidate as postgres.JSONValue)}, 0,
      ${record.createdAt}, ${record.createdAt}
    )`;
  return { inserted: true, record };
}

function parseSearchAlertSaga(record: IdempotencyRecord): SearchAlertPreparationSagaRecord {
  const responseBody = searchAlertObjectBody(record.responseBody, "preparation saga");
  const requiredStrings = [
    "ownerId",
    "requestId",
    "savedSearchId",
    "endpointId",
    "challengeId",
    "scheduleId",
    "issuedAt",
  ] as const;
  if (
    responseBody["version"] !== 1 ||
    responseBody["status"] !== "preparing" ||
    requiredStrings.some(
      (key) => typeof responseBody[key] !== "string" || responseBody[key].length === 0,
    )
  ) {
    return searchAlertConflict("The search-alert preparation saga identity is invalid.");
  }
  const sagaBody = responseBody as unknown as SearchAlertPreparationSagaBody;
  if (
    record.scope !== `search_alert.request_saga:${sagaBody.ownerId}` ||
    record.createdAt !== sagaBody.issuedAt
  ) {
    return searchAlertConflict("The search-alert preparation saga binding is invalid.");
  }
  searchAlertTimestampMs(sagaBody.issuedAt, "preparation issuance");
  searchAlertTimestampMs(record.expiresAt, "preparation expiry");
  return { ...record, responseBody: sagaBody };
}

async function findSearchAlertSagaForUpdate(
  sql: PostgresExecutor,
  ownerId: string,
  requestId: string,
): Promise<SearchAlertPreparationSagaRecord | null> {
  const rows = await sql<EntityRow[]>`
    SELECT id, owner_id, body, version
    FROM jobbbler.entity_records
    WHERE kind = 'idempotency'
      AND body->>'scope' = ${`search_alert.request_saga:${ownerId}`}
      AND body->'responseBody'->>'ownerId' = ${ownerId}
      AND body->'responseBody'->>'requestId' = ${requestId}
    ORDER BY id
    FOR UPDATE`;
  if (rows.length > 1) {
    return searchAlertConflict("The search-alert request is bound to multiple preparation sagas.");
  }
  return rows[0] === undefined ? null : parseSearchAlertSaga(idempotencyFromEntity(rows[0]));
}

function assertSearchAlertSagaLive(saga: SearchAlertPreparationSagaRecord, now: string): void {
  if (
    searchAlertTimestampMs(saga.expiresAt, "preparation expiry") <=
    searchAlertTimestampMs(now, "current")
  ) {
    searchAlertConflict("The search-alert preparation saga has expired.");
  }
}

async function searchAlertEvidenceForUpdate(
  sql: PostgresExecutor,
  saga: SearchAlertPreparationSagaRecord,
  reviewEvidenceHash: string,
  options: { readonly liveAt?: string } = {},
): Promise<{ readonly record: IdempotencyRecord; readonly body: SearchAlertReviewEvidenceBody }> {
  const sagaBody = saga.responseBody;
  const record = await getIdempotencyForUpdate(
    sql,
    `search_alert.request:${sagaBody.ownerId}`,
    sagaBody.requestId,
  );
  if (record === null || record.requestHash !== reviewEvidenceHash) {
    return searchAlertConflict("The search-alert review evidence is missing or has drifted.");
  }
  const responseBody = searchAlertObjectBody(record.responseBody, "review evidence");
  if (
    responseBody["purpose"] !== "search_alert_activation" ||
    responseBody["ownerId"] !== sagaBody.ownerId ||
    responseBody["requestId"] !== sagaBody.requestId ||
    responseBody["savedSearchId"] !== sagaBody.savedSearchId ||
    responseBody["savedSearchVersion"] !== 0 ||
    typeof responseBody["criteria"] !== "object" ||
    responseBody["criteria"] === null ||
    typeof responseBody["endpointId"] !== "string" ||
    responseBody["challengeId"] !== sagaBody.challengeId ||
    responseBody["scheduleId"] !== sagaBody.scheduleId ||
    typeof responseBody["recurrence"] !== "object" ||
    responseBody["recurrence"] === null ||
    typeof responseBody["firstRunAt"] !== "string" ||
    typeof responseBody["privacyNoticeVersion"] !== "string" ||
    responseBody["issuedAt"] !== sagaBody.issuedAt ||
    responseBody["expiresAt"] !== record.expiresAt
  ) {
    return searchAlertConflict("The search-alert review evidence binding is invalid.");
  }
  searchAlertTimestampMs(responseBody["firstRunAt"] as string, "first run");
  if (
    options.liveAt !== undefined &&
    searchAlertTimestampMs(record.expiresAt, "review expiry") <=
      searchAlertTimestampMs(options.liveAt, "current")
  ) {
    return searchAlertConflict("The search-alert review evidence has expired.");
  }
  return {
    record,
    body: responseBody as unknown as SearchAlertReviewEvidenceBody,
  };
}

async function optionalSearchAlertEvidenceForUpdate(
  sql: PostgresExecutor,
  saga: SearchAlertPreparationSagaRecord,
): Promise<{
  readonly record: IdempotencyRecord;
  readonly body: SearchAlertReviewEvidenceBody;
} | null> {
  const sagaBody = saga.responseBody;
  const record = await getIdempotencyForUpdate(
    sql,
    `search_alert.request:${sagaBody.ownerId}`,
    sagaBody.requestId,
  );
  return record === null ? null : searchAlertEvidenceForUpdate(sql, saga, record.requestHash);
}

function assertSearchAlertIntent(
  intent: IdempotencyRecord,
  ownerId: string,
  requestId: string,
  decision: "approved" | "declined",
): SearchAlertDecisionIntentBody {
  const responseBody = searchAlertObjectBody(intent.responseBody, "decision intent");
  if (
    intent.scope !== `search_alert.decision_intent:${ownerId}` ||
    intent.key !== requestId ||
    intent.responseStatus !== 202 ||
    responseBody["version"] !== 1 ||
    responseBody["status"] !== "deciding" ||
    responseBody["requestId"] !== requestId ||
    responseBody["decision"] !== decision ||
    responseBody["reviewBinding"] !== intent.requestHash ||
    responseBody["recordedAt"] !== intent.createdAt
  ) {
    searchAlertConflict("The search-alert decision intent binding is invalid.");
  }
  searchAlertTimestampMs(intent.createdAt, "decision intent recording");
  return responseBody as unknown as SearchAlertDecisionIntentBody;
}

function assertSearchAlertIntentLive(intent: IdempotencyRecord, now: string): void {
  const createdAt = searchAlertTimestampMs(intent.createdAt, "decision intent recording");
  const expiresAt = searchAlertTimestampMs(intent.expiresAt, "decision intent expiry");
  if (
    expiresAt <= searchAlertTimestampMs(now, "current") ||
    expiresAt <= createdAt ||
    expiresAt > createdAt + searchAlertDecisionIntentMaximumLifetimeMs
  ) {
    searchAlertConflict("The search-alert decision intent lifetime is invalid or expired.");
  }
}

function assertSearchAlertDecision(
  decisionRecord: IdempotencyRecord,
  saga: SearchAlertPreparationSagaRecord,
  review: SearchAlertReviewEvidenceBody,
  intent: IdempotencyRecord,
  decision: "approved" | "declined",
  schedule: ScheduleRecord | null,
): void {
  const intentBody = assertSearchAlertIntent(
    intent,
    saga.responseBody.ownerId,
    saga.responseBody.requestId,
    decision,
  );
  const responseBody = searchAlertObjectBody(decisionRecord.responseBody, "decision");
  const receipt = searchAlertObjectBody(responseBody["receipt"], "decision receipt");
  const evidence = searchAlertObjectBody(responseBody["evidence"], "decision evidence");
  const sagaBody = saga.responseBody;
  const sharedMismatch =
    decisionRecord.scope !== `search_alert.decision:${sagaBody.ownerId}` ||
    decisionRecord.key !== sagaBody.requestId ||
    decisionRecord.requestHash !== intent.requestHash ||
    decisionRecord.createdAt !== intentBody.recordedAt ||
    responseBody["version"] !== 1 ||
    responseBody["status"] !== "completed" ||
    receipt["status"] !== "completed" ||
    receipt["requestId"] !== sagaBody.requestId ||
    receipt["decision"] !== decision ||
    receipt["channel"] !== "agent_client" ||
    receipt["savedSearchId"] !== review.savedSearchId ||
    receipt["decidedAt"] !== intentBody.recordedAt ||
    typeof receipt["summary"] !== "string" ||
    evidence["reviewBinding"] !== intent.requestHash ||
    evidence["savedSearchId"] !== review.savedSearchId ||
    evidence["savedSearchVersion"] !== review.savedSearchVersion ||
    evidence["endpointId"] !== review.endpointId ||
    !isDeepStrictEqual(evidence["criteria"], review.criteria) ||
    !isDeepStrictEqual(evidence["recurrence"], review.recurrence) ||
    evidence["firstRunAt"] !== review.firstRunAt ||
    evidence["privacyNoticeVersion"] !== review.privacyNoticeVersion ||
    evidence["channel"] !== "agent_client" ||
    evidence["decidedAt"] !== intentBody.recordedAt;
  const decisionMismatch =
    decision === "approved"
      ? schedule === null ||
        schedule.ownerId !== sagaBody.ownerId ||
        schedule.id !== sagaBody.scheduleId ||
        schedule.savedSearchId !== review.savedSearchId ||
        schedule.deliveryEndpointId !== review.endpointId ||
        !isDeepStrictEqual(schedule.recurrence, review.recurrence) ||
        schedule.nextRunAt !== review.firstRunAt ||
        schedule.createdAt !== intentBody.recordedAt ||
        schedule.updatedAt !== intentBody.recordedAt ||
        receipt["scheduleId"] !== schedule.id ||
        receipt["nextRunAt"] !== schedule.nextRunAt
      : schedule !== null || receipt["scheduleId"] !== null || receipt["nextRunAt"] !== null;
  if (sharedMismatch || decisionMismatch) {
    searchAlertConflict("The search-alert decision envelope binding is invalid.");
  }
}

async function liveApprovedSearchAlertIntent(
  sql: PostgresExecutor,
  saga: SearchAlertPreparationSagaRecord,
  now: string,
): Promise<boolean> {
  const sagaBody = saga.responseBody;
  const intent = await getIdempotencyForUpdate(
    sql,
    `search_alert.decision_intent:${sagaBody.ownerId}`,
    sagaBody.requestId,
  );
  if (intent === null) return false;
  const responseBody = searchAlertObjectBody(intent.responseBody, "decision intent");
  if (
    intent.scope !== `search_alert.decision_intent:${sagaBody.ownerId}` ||
    intent.key !== sagaBody.requestId ||
    intent.responseStatus !== 202 ||
    responseBody["version"] !== 1 ||
    responseBody["status"] !== "deciding" ||
    responseBody["requestId"] !== sagaBody.requestId ||
    responseBody["reviewBinding"] !== intent.requestHash ||
    responseBody["recordedAt"] !== intent.createdAt ||
    (responseBody["decision"] !== "approved" && responseBody["decision"] !== "declined")
  ) {
    return searchAlertConflict("The stored search-alert decision intent has drifted.");
  }
  const createdAt = searchAlertTimestampMs(intent.createdAt, "decision intent recording");
  const expiresAt = searchAlertTimestampMs(intent.expiresAt, "decision intent expiry");
  if (
    expiresAt <= searchAlertTimestampMs(now, "current") ||
    expiresAt <= createdAt ||
    expiresAt > createdAt + searchAlertDecisionIntentMaximumLifetimeMs
  ) {
    return false;
  }
  return responseBody["decision"] === "approved";
}

async function exactCommittedSearchAlertApproval(
  sql: PostgresExecutor,
  saga: SearchAlertPreparationSagaRecord,
): Promise<boolean> {
  const sagaBody = saga.responseBody;
  const schedule = await getForUpdate<ScheduleRecord>(sql, "schedule", sagaBody.scheduleId);
  const decision = await getIdempotencyForUpdate(
    sql,
    `search_alert.decision:${sagaBody.ownerId}`,
    sagaBody.requestId,
  );
  if (decision === null) return false;
  const envelope = searchAlertObjectBody(decision.responseBody, "decision");
  const receipt = searchAlertObjectBody(envelope["receipt"], "decision receipt");
  const evidence = searchAlertObjectBody(envelope["evidence"], "decision evidence");
  if (
    receipt["requestId"] !== sagaBody.requestId ||
    receipt["scheduleId"] !== sagaBody.scheduleId ||
    evidence["savedSearchId"] !== sagaBody.savedSearchId ||
    evidence["reviewBinding"] !== decision.requestHash
  ) {
    return searchAlertConflict("The durable search-alert decision has drifted from its saga.");
  }
  if (receipt["decision"] === "declined") {
    if (receipt["scheduleId"] !== null || receipt["nextRunAt"] !== null) {
      return searchAlertConflict("The durable search-alert decline is invalid.");
    }
    return false;
  }
  if (receipt["decision"] !== "approved") {
    return searchAlertConflict("The durable search-alert decision is invalid.");
  }
  if (
    schedule === null ||
    schedule.ownerId !== sagaBody.ownerId ||
    schedule.savedSearchId !== sagaBody.savedSearchId
  ) {
    return searchAlertConflict("The durable search-alert approval has drifted from its schedule.");
  }
  return true;
}

async function finalizeSearchAlertPreparation(
  sql: PostgresExecutor,
  saga: SearchAlertPreparationSagaRecord,
  evidence: { readonly body: SearchAlertReviewEvidenceBody } | null,
): Promise<boolean> {
  const sagaBody = saga.responseBody;
  const storedSaga = await getIdempotencyForUpdate(sql, saga.scope, saga.key);
  if (storedSaga === null) return false;
  if (!isDeepStrictEqual(storedSaga, saga)) {
    return searchAlertConflict("The search-alert preparation saga changed before cleanup.");
  }

  const challenge = await getForUpdate<VerificationChallengeRecord>(
    sql,
    "verification_challenge",
    sagaBody.challengeId,
  );
  if (
    challenge !== null &&
    (challenge.ownerId !== sagaBody.ownerId ||
      (challenge.purpose ?? "owner_email_verification") !== "search_alert_review" ||
      (evidence !== null && challenge.endpointId !== evidence.body.endpointId))
  ) {
    return searchAlertConflict("The search-alert review challenge changed before cleanup.");
  }

  await sql`
    DELETE FROM jobbbler.entity_records AS saved_search
    WHERE saved_search.kind = 'saved_search'
      AND saved_search.id = ${sagaBody.savedSearchId}
      AND saved_search.owner_id = ${sagaBody.ownerId}
      AND saved_search.body->>'version' = '0'
      AND saved_search.body->>'createdAt' = ${sagaBody.issuedAt}
      AND NOT EXISTS (
        SELECT 1
        FROM jobbbler.entity_records AS schedule
        WHERE schedule.kind = 'schedule'
          AND schedule.body->>'savedSearchId' = saved_search.id
      )`;

  if (challenge !== null) {
    const deletedChallenge = await sql<{ readonly id: string }[]>`
      DELETE FROM jobbbler.entity_records
      WHERE kind = 'verification_challenge'
        AND id = ${challenge.id}
        AND owner_id = ${sagaBody.ownerId}
        AND COALESCE(body->>'purpose', 'owner_email_verification') = 'search_alert_review'
        AND body->>'endpointId' = ${challenge.endpointId}
      RETURNING id`;
    if (deletedChallenge[0] === undefined) {
      return searchAlertConflict("The search-alert review challenge changed during cleanup.");
    }
    await deletePendingOrphanVerificationEndpoint(sql, sagaBody.ownerId, challenge.endpointId);
  }

  for (const [scope, key] of [
    [`search_alert.request_claim:${sagaBody.ownerId}`, saga.key],
    [`search_alert.request_result:${sagaBody.ownerId}`, saga.key],
    [`search_alert.request:${sagaBody.ownerId}`, sagaBody.requestId],
    [`search_alert.decision_claim:${sagaBody.ownerId}`, sagaBody.requestId],
    [`search_alert.decision_intent:${sagaBody.ownerId}`, sagaBody.requestId],
  ] as const) {
    await sql`
      DELETE FROM jobbbler.entity_records
      WHERE kind = 'idempotency' AND id = ${`${scope}:${key}`}`;
  }

  const sagaWithId = { ...saga, id: `${saga.scope}:${saga.key}` };
  const deletedSaga = await sql<{ readonly id: string }[]>`
    DELETE FROM jobbbler.entity_records
    WHERE kind = 'idempotency'
      AND id = ${sagaWithId.id}
      AND body = ${sql.json(sagaWithId as unknown as postgres.JSONValue)}
    RETURNING id`;
  if (deletedSaga[0] === undefined) {
    return searchAlertConflict("The search-alert preparation saga changed during cleanup.");
  }
  return true;
}

async function commitApprovedSearchAlertPostgres(
  sql: PostgresExecutor,
  input: SearchAlertActivationInput,
): Promise<SearchAlertActivationResult> {
  if (
    input.schedule.deliveryEndpointId !== input.verifiedEndpointId ||
    input.decision.scope !== `search_alert.decision:${input.schedule.ownerId}`
  ) {
    return searchAlertConflict(
      "Search-alert activation is not bound to the reviewed owner and endpoint.",
    );
  }

  await sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`search-alert-activation:${input.schedule.ownerId}:${input.schedule.savedSearchId}`},
        0
      )
    )`;

  const scheduleRows = await sql<EntityRow[]>`
    SELECT id, owner_id, body, version
    FROM jobbbler.entity_records
    WHERE kind = 'schedule'
      AND (
        id = ${input.schedule.id}
        OR (
          owner_id = ${input.schedule.ownerId}
          AND body->>'savedSearchId' = ${input.schedule.savedSearchId}
        )
      )
    ORDER BY CASE WHEN id = ${input.schedule.id} THEN 0 ELSE 1 END
    FOR UPDATE`;
  const storedSchedule =
    scheduleRows[0] === undefined ? null : body<ScheduleRecord>(scheduleRows[0]);
  if (
    scheduleRows.length > 1 ||
    (storedSchedule !== null && !isDeepStrictEqual(storedSchedule, input.schedule))
  ) {
    return searchAlertConflict("The reviewed search-alert schedule conflicts with stored state.");
  }
  const storedDecision = await getIdempotencyForUpdate(
    sql,
    input.decision.scope,
    input.decision.key,
  );
  if (storedDecision !== null && !isDeepStrictEqual(storedDecision, input.decision)) {
    return searchAlertConflict("The search-alert decision receipt conflicts with stored state.");
  }
  if (storedSchedule === null && storedDecision !== null) {
    return searchAlertConflict(
      "A search-alert decision receipt exists without its exact schedule.",
    );
  }
  if (storedSchedule !== null && storedDecision !== null) {
    return { inserted: false, schedule: storedSchedule, decision: storedDecision };
  }

  const savedSearch = await getForUpdate<SavedSearchRecord>(
    sql,
    "saved_search",
    input.schedule.savedSearchId,
  );
  const endpoint = await getForUpdate<VerificationEndpointRecord>(
    sql,
    "verification_endpoint",
    input.verifiedEndpointId,
  );
  const owner = await getForUpdate<OwnerRecord>(sql, "owner", input.schedule.ownerId);
  if (
    savedSearch === null ||
    savedSearch.ownerId !== input.schedule.ownerId ||
    savedSearch.version !== input.expectedSavedSearchVersion
  ) {
    return searchAlertConflict("The reviewed saved search changed before alert activation.");
  }
  if (
    endpoint === null ||
    endpoint.ownerId !== input.schedule.ownerId ||
    endpoint.status !== "verified"
  ) {
    return searchAlertConflict("The reviewed delivery endpoint is no longer verified.");
  }
  if (owner === null || !owner.verified) {
    return searchAlertConflict("The search-alert owner is no longer verified.");
  }

  if (storedSchedule === null) {
    await sql`
      INSERT INTO jobbbler.entity_records(
        kind, id, owner_id, body, version, created_at, updated_at
      ) VALUES (
        'schedule', ${input.schedule.id}, ${input.schedule.ownerId},
        ${sql.json(input.schedule as unknown as postgres.JSONValue)},
        ${input.schedule.version}, ${input.schedule.createdAt}, ${input.schedule.updatedAt}
      )`;
  }
  if (storedDecision === null) {
    await putExactIdempotencyRecord(sql, input.decision);
  }
  return {
    inserted: storedDecision === null,
    schedule: storedSchedule ?? input.schedule,
    decision: storedDecision ?? input.decision,
  };
}

function createIdentityStore(sql: PostgresSql): IdentityStore {
  return {
    async createOwnerWithSession(input): Promise<ResolvedOwnerSession> {
      if (input.owner.id !== input.session.ownerId)
        throw new TypeError("Owner session must belong to the owner being created.");
      await sql.begin(async (transaction) => {
        await insert(transaction, "owner", input.owner, input.owner.id);
        await insert(transaction, "owner_session", input.session, input.owner.id);
      });
      return { owner: input.owner, session: input.session };
    },
    async resolveSession(tokenHash, now) {
      const session = await findOwnerSessionByTokenHash(sql, tokenHash);
      if (session === null) return null;
      if (session.status === "active" && session.expiresAt <= now)
        await write(sql, "owner_session", { ...session, status: "expired", updatedAt: now });
      const active = session.status === "active" && session.expiresAt > now ? session : null;
      if (active === null) return null;
      const owner = await get<OwnerIdentityRecord>(sql, "owner", active.ownerId);
      if (owner === null) return null;
      const refreshed = { ...active, lastSeenAt: now, updatedAt: now };
      await write(sql, "owner_session", refreshed, active.ownerId);
      return { owner, session: refreshed };
    },
    async beginEmailVerification(input) {
      if (input.endpoint.ownerId !== input.challenge.ownerId)
        throw new TypeError("Verification challenge and endpoint must belong to the same owner.");
      return sql.begin(async (transaction) => {
        const tx = transaction as PostgresExecutor;
        const purpose = input.challenge.purpose ?? "owner_email_verification";
        const existingChallenge = await getForUpdate<VerificationChallengeRecord>(
          tx,
          "verification_challenge",
          input.challenge.id,
        );
        if (existingChallenge !== null) {
          const existingEndpoint = await getForUpdate<VerificationEndpointRecord>(
            tx,
            "verification_endpoint",
            existingChallenge.endpointId,
          );
          const exact =
            existingEndpoint !== null &&
            existingEndpoint.ownerId === input.endpoint.ownerId &&
            existingEndpoint.kind === input.endpoint.kind &&
            existingEndpoint.addressHash === input.endpoint.addressHash &&
            existingChallenge.ownerId === input.challenge.ownerId &&
            (existingChallenge.purpose ?? "owner_email_verification") === purpose &&
            existingChallenge.tokenHash === input.challenge.tokenHash &&
            existingChallenge.maxAttempts === input.challenge.maxAttempts &&
            existingChallenge.expiresAt === input.challenge.expiresAt &&
            existingChallenge.createdAt === input.challenge.createdAt;
          if (!exact) {
            throw domain(
              "CONFLICT",
              "The verification challenge identifier is already bound to different data.",
            );
          }
          if (purpose === "search_alert_review" && existingEndpoint.status === "revoked") {
            throw new DomainError({
              code: "CONFLICT",
              message: "This delivery address is revoked and cannot be used for search alerts.",
              details: { reason: "revoked_destination" },
            });
          }
          return { endpoint: existingEndpoint, challenge: existingChallenge };
        }
        const endpointRows = await tx<EntityRow[]>`
          SELECT id, owner_id, body, version
          FROM jobbbler.entity_records
          WHERE kind = 'verification_endpoint'
            AND owner_id = ${input.endpoint.ownerId}
            AND body->>'kind' = ${input.endpoint.kind}
            AND body->>'addressHash' = ${input.endpoint.addressHash}
          FOR UPDATE`;
        const existing =
          endpointRows[0] === undefined
            ? undefined
            : body<VerificationEndpointRecord>(endpointRows[0]);
        const endpoint =
          existing === undefined
            ? input.endpoint
            : existing.status === "verified" || existing.status === "revoked"
              ? existing
              : { ...input.endpoint, id: existing.id };
        if (
          existing === undefined ||
          (existing.status !== "verified" && existing.status !== "revoked")
        ) {
          await write(tx, "verification_endpoint", endpoint, endpoint.ownerId);
        }
        if (purpose === "search_alert_review" && endpoint.status === "revoked") {
          throw new DomainError({
            code: "CONFLICT",
            message: "This delivery address is revoked and cannot be used for search alerts.",
            details: { reason: "revoked_destination" },
          });
        }
        for (const challenge of await list<VerificationChallengeRecord>(
          tx,
          "verification_challenge",
          input.challenge.ownerId,
        )) {
          if (
            purpose === "owner_email_verification" &&
            challenge.status === "pending" &&
            (challenge.purpose ?? "owner_email_verification") === purpose
          )
            await write(
              tx,
              "verification_challenge",
              { ...challenge, status: "expired", updatedAt: input.challenge.updatedAt },
              challenge.ownerId,
            );
        }
        const storedChallenge = { ...input.challenge, endpointId: endpoint.id, purpose };
        await insert(tx, "verification_challenge", storedChallenge, storedChallenge.ownerId);
        return { endpoint, challenge: storedChallenge };
      });
    },
    async consumeEmailVerification(input): Promise<ConsumeVerificationResult> {
      return sql.begin(async (transaction) => {
        const tx = transaction as PostgresExecutor;
        const challenge = await getForUpdate<VerificationChallengeRecord>(
          tx,
          "verification_challenge",
          input.challengeId,
        );
        if (challenge === null || challenge.ownerId !== input.ownerId)
          return { status: "invalid", remainingAttempts: 0 };
        const challengePurpose = challenge.purpose ?? "owner_email_verification";
        if (input.expectedPurpose !== undefined && challengePurpose !== input.expectedPurpose) {
          return { status: "invalid", remainingAttempts: 0 };
        }
        if (challenge.status === "consumed") {
          if (input.acceptConsumed !== true) return { status: "consumed" };
          if (challenge.tokenHash !== input.tokenHash) {
            return { status: "invalid", remainingAttempts: 0 };
          }
          const consumedEndpoint = await getForUpdate<VerificationEndpointRecord>(
            tx,
            "verification_endpoint",
            challenge.endpointId,
          );
          const consumedOwner = await getForUpdate<OwnerIdentityRecord>(tx, "owner", input.ownerId);
          if (
            consumedEndpoint === null ||
            consumedOwner === null ||
            consumedEndpoint.status !== "verified"
          ) {
            return { status: "consumed" };
          }
          return { status: "verified", owner: consumedOwner, endpoint: consumedEndpoint };
        }
        if (challenge.status !== "pending") return { status: challenge.status };
        if (challenge.expiresAt <= input.now) {
          await write(
            tx,
            "verification_challenge",
            { ...challenge, status: "expired", updatedAt: input.now },
            challenge.ownerId,
          );
          return { status: "expired" };
        }
        if (challenge.tokenHash !== input.tokenHash) {
          const attempts = challenge.attempts + 1;
          const locked = attempts >= challenge.maxAttempts;
          await write(
            tx,
            "verification_challenge",
            { ...challenge, attempts, status: locked ? "locked" : "pending", updatedAt: input.now },
            challenge.ownerId,
          );
          return locked
            ? { status: "locked" }
            : { status: "invalid", remainingAttempts: challenge.maxAttempts - attempts };
        }
        const endpoint = await getForUpdate<VerificationEndpointRecord>(
          tx,
          "verification_endpoint",
          challenge.endpointId,
        );
        const owner = await getForUpdate<OwnerIdentityRecord>(tx, "owner", input.ownerId);
        if (endpoint === null || owner === null) return { status: "invalid", remainingAttempts: 0 };
        const consumed = {
          ...challenge,
          status: "consumed" as const,
          consumedAt: input.now,
          updatedAt: input.now,
        };
        const verifiedEndpoint =
          endpoint.status === "verified"
            ? endpoint
            : {
                ...endpoint,
                status: "verified" as const,
                verifiedAt: input.now,
                updatedAt: input.now,
              };
        const verifiedOwner = owner.verified
          ? owner
          : {
              ...owner,
              kind: owner.kind === "ephemeral" ? ("guest" as const) : owner.kind,
              verified: true,
              version: owner.version + 1,
              updatedAt: input.now,
            };
        await write(tx, "verification_challenge", consumed, owner.id);
        if (endpoint.status !== "verified") {
          await write(tx, "verification_endpoint", verifiedEndpoint, owner.id);
        }
        if (!owner.verified) {
          await write(tx, "owner", verifiedOwner, owner.id, verifiedOwner.version);
        }
        return { status: "verified", owner: verifiedOwner, endpoint: verifiedEndpoint };
      });
    },
    async abandonEmailVerification(input) {
      return sql.begin(async (transaction) => {
        const tx = transaction as PostgresExecutor;
        const challenge = await getForUpdate<VerificationChallengeRecord>(
          tx,
          "verification_challenge",
          input.challengeId,
        );
        if (
          challenge?.ownerId !== input.ownerId ||
          (challenge.purpose ?? "owner_email_verification") !== input.expectedPurpose
        ) {
          return false;
        }
        await tx`
          DELETE FROM jobbbler.entity_records
          WHERE kind = 'verification_challenge'
            AND id = ${challenge.id}
            AND owner_id = ${input.ownerId}`;
        await deletePendingOrphanVerificationEndpoint(tx, input.ownerId, challenge.endpointId);
        return true;
      });
    },
    async purgeExpiredEmailVerifications(input) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
        throw new TypeError("Verification retention limit must be between 1 and 1000.");
      }
      return sql.begin(async (transaction) => {
        const tx = transaction as PostgresExecutor;
        const rows = await tx<EntityRow[]>`
          SELECT id, owner_id, body, version
          FROM jobbbler.entity_records
          WHERE kind = 'verification_challenge'
            AND COALESCE(body->>'purpose', 'owner_email_verification') = ${input.purpose}
            AND body->>'expiresAt' <= ${input.now}
          ORDER BY body->>'expiresAt', id
          FOR UPDATE SKIP LOCKED
          LIMIT ${input.limit}`;
        const expired = rows.map(body<VerificationChallengeRecord>);
        for (const challenge of expired) {
          await tx`
            DELETE FROM jobbbler.entity_records
            WHERE kind = 'verification_challenge' AND id = ${challenge.id}`;
          await deletePendingOrphanVerificationEndpoint(
            tx,
            challenge.ownerId,
            challenge.endpointId,
          );
        }
        return expired.length;
      });
    },
    async getVerificationEndpoint(ownerId, endpointId) {
      const endpoint = await get<VerificationEndpointRecord>(
        sql,
        "verification_endpoint",
        endpointId,
      );
      return endpoint?.ownerId === ownerId ? endpoint : null;
    },
    async listVerificationEndpoints(ownerId) {
      return list<VerificationEndpointRecord>(sql, "verification_endpoint", ownerId);
    },
    async revokeVerificationEndpoint(ownerId, endpointId, now) {
      return sql.begin(async (transaction) => {
        const tx = transaction as PostgresExecutor;
        const endpoint = await get<VerificationEndpointRecord>(
          tx,
          "verification_endpoint",
          endpointId,
        );
        if (endpoint === null || endpoint.ownerId !== ownerId) return null;
        if (endpoint.status === "revoked") return endpoint;
        const revoked = {
          ...endpoint,
          status: "revoked" as const,
          verifiedAt: null,
          updatedAt: now,
        };
        await write(tx, "verification_endpoint", revoked, ownerId);
        for (const challenge of await list<VerificationChallengeRecord>(
          tx,
          "verification_challenge",
          ownerId,
        ))
          if (challenge.endpointId === endpointId && challenge.status === "pending")
            await write(
              tx,
              "verification_challenge",
              { ...challenge, status: "expired", updatedAt: now },
              ownerId,
            );
        for (const challenge of await list<OwnerRecoveryChallengeRecord>(
          tx,
          "owner_recovery_challenge",
          ownerId,
        ))
          if (challenge.endpointId === endpointId && challenge.status === "pending")
            await write(
              tx,
              "owner_recovery_challenge",
              { ...challenge, status: "expired", updatedAt: now },
              ownerId,
            );
        for (const schedule of await list<ScheduleRecord>(tx, "schedule", ownerId))
          if (schedule.deliveryEndpointId === endpointId && schedule.enabled)
            await write(
              tx,
              "schedule",
              { ...schedule, enabled: false, version: schedule.version + 1, updatedAt: now },
              ownerId,
              schedule.version + 1,
            );
        return revoked;
      });
    },
    async beginOwnerRecovery(input) {
      return sql.begin(async (transaction) => {
        const tx = transaction as PostgresExecutor;
        const rows = await tx<EntityRow[]>`
          SELECT id, owner_id, body, version
          FROM jobbbler.entity_records
          WHERE kind = 'verification_endpoint'
            AND body->>'addressHash' = ${input.addressHash}
            AND body->>'status' = 'verified'
          FOR UPDATE`;
        if (rows.length !== 1) return null;
        const endpoint = body<VerificationEndpointRecord>(rows[0]!);
        const pendingRows = await tx<EntityRow[]>`
          SELECT id, owner_id, body, version
          FROM jobbbler.entity_records
          WHERE kind = 'owner_recovery_challenge'
            AND owner_id = ${endpoint.ownerId}
            AND body->>'status' = 'pending'
          FOR UPDATE`;
        for (const row of pendingRows) {
          const pending = body<OwnerRecoveryChallengeRecord>(row);
          await write(
            tx,
            "owner_recovery_challenge",
            { ...pending, status: "expired", updatedAt: input.challenge.updatedAt },
            endpoint.ownerId,
          );
        }
        const challenge: OwnerRecoveryChallengeRecord = {
          ...input.challenge,
          ownerId: endpoint.ownerId,
          endpointId: endpoint.id,
        };
        await insert(tx, "owner_recovery_challenge", challenge, endpoint.ownerId);
        return { endpoint, challenge };
      });
    },
    async consumeOwnerRecovery(input): Promise<ConsumeOwnerRecoveryResult> {
      return sql.begin(async (transaction) => {
        const tx = transaction as PostgresExecutor;
        const challenge = await getForUpdate<OwnerRecoveryChallengeRecord>(
          tx,
          "owner_recovery_challenge",
          input.challengeId,
        );
        if (challenge === null) return { status: "invalid" };
        if (challenge.status !== "pending") return { status: challenge.status };
        if (challenge.expiresAt <= input.now) {
          await write(
            tx,
            "owner_recovery_challenge",
            { ...challenge, status: "expired", updatedAt: input.now },
            challenge.ownerId,
          );
          return { status: "expired" };
        }
        if (challenge.tokenHash !== input.tokenHash) {
          const attempts = challenge.attempts + 1;
          const locked = attempts >= challenge.maxAttempts;
          await write(
            tx,
            "owner_recovery_challenge",
            {
              ...challenge,
              attempts,
              status: locked ? "locked" : "pending",
              updatedAt: input.now,
            },
            challenge.ownerId,
          );
          return { status: locked ? "locked" : "invalid" };
        }
        const owner = await getForUpdate<OwnerIdentityRecord>(tx, "owner", challenge.ownerId);
        const endpoint = await getForUpdate<VerificationEndpointRecord>(
          tx,
          "verification_endpoint",
          challenge.endpointId,
        );
        if (
          owner === null ||
          !owner.verified ||
          endpoint === null ||
          endpoint.ownerId !== owner.id ||
          endpoint.status !== "verified"
        ) {
          return { status: "invalid" };
        }
        const sessionRows = await tx<EntityRow[]>`
          SELECT id, owner_id, body, version
          FROM jobbbler.entity_records
          WHERE kind = 'owner_session' AND owner_id = ${owner.id}
          FOR UPDATE`;
        const consumed: OwnerRecoveryChallengeRecord = {
          ...challenge,
          status: "consumed",
          consumedAt: input.now,
          updatedAt: input.now,
        };
        await write(tx, "owner_recovery_challenge", consumed, owner.id);
        for (const row of sessionRows) {
          const session = body<OwnerSessionRecord>(row);
          if (session.status === "active") {
            await write(
              tx,
              "owner_session",
              { ...session, status: "revoked", updatedAt: input.now },
              owner.id,
            );
          }
        }
        const session: OwnerSessionRecord = { ...input.session, ownerId: owner.id };
        await insert(tx, "owner_session", session, owner.id);
        return { status: "recovered", owner, session };
      });
    },
    async beginOwnerDeletion(intent: OwnerDeletionIntentRecord) {
      return sql.begin(async (transaction) => {
        const tx = transaction as PostgresExecutor;
        const owner = await getForUpdate<OwnerIdentityRecord>(tx, "owner", intent.ownerId);
        if (owner === null) throw domain("NOT_FOUND", "Owner was not found.");
        const rows = await tx<EntityRow[]>`
          SELECT id, owner_id, body, version
          FROM jobbbler.entity_records
          WHERE kind = 'owner_deletion_intent'
            AND owner_id = ${intent.ownerId}
            AND body->>'status' = 'pending'
          FOR UPDATE`;
        for (const row of rows) {
          const pending = body<OwnerDeletionIntentRecord>(row);
          await write(
            tx,
            "owner_deletion_intent",
            { ...pending, status: "expired", updatedAt: intent.updatedAt },
            intent.ownerId,
          );
        }
        await insert(tx, "owner_deletion_intent", intent, intent.ownerId);
        return intent;
      });
    },
    async deleteOwnerPrivateData(input) {
      return sql.begin(async (transaction) => {
        const tx = transaction as PostgresExecutor;
        const intent = await getForUpdate<OwnerDeletionIntentRecord>(
          tx,
          "owner_deletion_intent",
          input.deletionId,
        );
        const session = await getForUpdate<OwnerSessionRecord>(
          tx,
          "owner_session",
          input.sessionId,
        );
        if (
          intent === null ||
          intent.ownerId !== input.ownerId ||
          intent.status !== "pending" ||
          intent.expiresAt <= input.now ||
          session === null ||
          session.ownerId !== input.ownerId ||
          session.status !== "active" ||
          session.expiresAt <= input.now
        ) {
          if (
            intent !== null &&
            intent.ownerId === input.ownerId &&
            intent.status === "pending" &&
            intent.expiresAt <= input.now
          ) {
            await write(
              tx,
              "owner_deletion_intent",
              { ...intent, status: "expired", updatedAt: input.now },
              input.ownerId,
            );
          }
          return false;
        }
        const owner = await getForUpdate<OwnerIdentityRecord>(tx, "owner", input.ownerId);
        if (owner === null) return false;
        const privatePattern = `%${input.ownerId}%`;
        await tx`
          UPDATE jobbbler.entity_records AS audit
          SET body = audit.body || ${tx.json({
            actorId: null,
            aggregateId: "deleted",
            correlationId: "deleted",
            safeMetadata: { redacted: true },
          })},
              updated_at = ${input.now}
          WHERE audit.kind = 'audit'
            AND (
              audit.body->>'actorId' = ${input.ownerId}
              OR audit.body::text LIKE ${privatePattern}
              OR audit.body->>'aggregateId' IN (
                SELECT private.id FROM jobbbler.entity_records AS private
                WHERE private.owner_id = ${input.ownerId}
              )
            )`;
        await tx`
          DELETE FROM jobbbler.entity_records AS work
          WHERE work.kind = 'work_item'
            AND (
              work.body::text LIKE ${privatePattern}
              OR work.body->'payload'->>'deliveryId' IN (
                SELECT delivery.id FROM jobbbler.entity_records AS delivery
                WHERE delivery.kind = 'alert_delivery'
                  AND delivery.owner_id = ${input.ownerId}
              )
            )`;
        await tx`
          DELETE FROM jobbbler.entity_records AS detached
          WHERE detached.owner_id IS NULL
            AND detached.kind IN ('idempotency', 'outbox')
            AND detached.body::text LIKE ${privatePattern}`;
        await tx`DELETE FROM jobbbler.owner_activity_events WHERE owner_id = ${input.ownerId}`;
        await tx`DELETE FROM jobbbler.entity_records WHERE owner_id = ${input.ownerId}`;
        return true;
      });
    },
  };
}

export function createPostgresStorage(databaseUrl: string): PostgresStorage {
  const sql = openPostgresDatabase(databaseUrl);
  const identity = createIdentityStore(sql);
  const storage: PostgresStorage = {
    sql,
    identity,
    owners: {
      async insert(record) {
        return insert(sql, "owner", record, record.id);
      },
      async getById(id) {
        return get<OwnerRecord>(sql, "owner", id);
      },
    },
    organizations: {
      async upsert(record) {
        return write(sql, "organization", record);
      },
      async getById(id) {
        return get<OrganizationRecord>(sql, "organization", id);
      },
    },
    jobs: {
      async upsert(record) {
        return upsertJob(sql, record);
      },
      async getById(id) {
        return get<Job>(sql, "job", id);
      },
      async listAll() {
        return (await list<Job>(sql, "job")).sort((left, right) => left.id.localeCompare(right.id));
      },
      async search(query) {
        return searchPostgresJobs(sql, query);
      },
      async suggestLocations(query, limit) {
        const normalizedQuery = query.trim().slice(0, 120).toLocaleLowerCase("en");
        if (normalizedQuery.length === 0) return [];
        const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit)));
        const rows = await sql<{ readonly value: string }[]>`
          SELECT min(value) AS value
          FROM jobbbler.job_location_suggestions
          WHERE position(${normalizedQuery} in normalized_value) > 0
          GROUP BY normalized_value
          ORDER BY
            CASE WHEN normalized_value = ${normalizedQuery} THEN 0 ELSE 1 END,
            CASE
              WHEN left(normalized_value, char_length(${normalizedQuery})) = ${normalizedQuery}
                THEN 0
              ELSE 1
            END,
            count(*) DESC,
            normalized_value ASC
          LIMIT ${safeLimit}`;
        return rows.map(({ value }) => value);
      },
    },
    savedSearches: {
      async insert(record) {
        return insert(sql, "saved_search", record, record.ownerId);
      },
      async getById(id) {
        return get<SavedSearchRecord>(sql, "saved_search", id);
      },
      async listByOwner(ownerId) {
        return list<SavedSearchRecord>(sql, "saved_search", ownerId);
      },
      async update(record, expectedVersion) {
        return updateVersioned(sql, "saved_search", record, expectedVersion);
      },
      async delete(id) {
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const existing = await tx<{ readonly id: string }[]>`
            SELECT id FROM jobbbler.entity_records
            WHERE kind = 'saved_search' AND id = ${id}
            FOR UPDATE`;
          if (existing.length === 0) return false;
          await tx`
            DELETE FROM jobbbler.entity_records
            WHERE kind = 'alert_change' AND body->>'evaluationId' IN (
              SELECT evaluation.id FROM jobbbler.entity_records AS evaluation
              WHERE evaluation.kind = 'alert_evaluation'
                AND evaluation.body->>'savedSearchId' = ${id}
            )`;
          await tx`
            DELETE FROM jobbbler.entity_records
            WHERE kind = 'alert_delivery' AND body->>'scheduleId' IN (
              SELECT schedule.id FROM jobbbler.entity_records AS schedule
              WHERE schedule.kind = 'schedule' AND schedule.body->>'savedSearchId' = ${id}
            )`;
          await tx`
            DELETE FROM jobbbler.entity_records
            WHERE kind = 'alert_evaluation' AND body->>'savedSearchId' = ${id}`;
          await tx`
            DELETE FROM jobbbler.entity_records
            WHERE kind = 'schedule' AND body->>'savedSearchId' = ${id}`;
          await tx`
            DELETE FROM jobbbler.entity_records
            WHERE kind = 'saved_search' AND id = ${id}`;
          return true;
        });
      },
    },
    schedules: {
      async insert(record) {
        const existing = (await list<ScheduleRecord>(sql, "schedule", record.ownerId)).find(
          (item) => item.savedSearchId === record.savedSearchId,
        );
        if (existing !== undefined)
          throw domain("CONFLICT", "An owner can have only one schedule for a saved search.");
        return insert(sql, "schedule", record, record.ownerId);
      },
      async getById(id) {
        return get<ScheduleRecord>(sql, "schedule", id);
      },
      async listByOwner(ownerId) {
        return list<ScheduleRecord>(sql, "schedule", ownerId);
      },
      async listDue(now, limit) {
        return (await list<ScheduleRecord>(sql, "schedule"))
          .filter((item) => item.enabled && item.nextRunAt <= now)
          .sort(
            (left, right) =>
              left.nextRunAt.localeCompare(right.nextRunAt) || left.id.localeCompare(right.id),
          )
          .slice(0, limit);
      },
      async update(record, expectedVersion) {
        return updateVersioned(sql, "schedule", record, expectedVersion);
      },
    },
    searchAlertActivation: {
      async commitApproved(input) {
        try {
          return await sql.begin(async (transaction) => {
            return commitApprovedSearchAlertPostgres(transaction as PostgresExecutor, input);
          });
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as { readonly code?: unknown }).code === "23505"
          ) {
            throw domain("CONFLICT", "The search-alert activation conflicts with stored state.");
          }
          throw error;
        }
      },
    },
    searchAlertPreparation: {
      async beginApproved(input) {
        try {
          return await sql.begin(async (transaction) => {
            const tx = transaction as PostgresExecutor;
            const saga = await findSearchAlertSagaForUpdate(tx, input.ownerId, input.requestId);
            if (saga === null) {
              return searchAlertConflict("The search-alert preparation saga was not found.");
            }
            assertSearchAlertSagaLive(saga, input.now);
            await searchAlertEvidenceForUpdate(tx, saga, input.reviewEvidenceHash, {
              liveAt: input.now,
            });
            assertSearchAlertIntent(input.intent, input.ownerId, input.requestId, "approved");
            assertSearchAlertIntentLive(input.intent, input.now);
            return putExactIdempotencyRecord(tx, input.intent);
          });
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as { readonly code?: unknown }).code === "23505"
          ) {
            throw domain("CONFLICT", "The search-alert decision intent conflicts with state.");
          }
          throw error;
        }
      },
      async commitApproved(input) {
        try {
          return await sql.begin(async (transaction) => {
            const tx = transaction as PostgresExecutor;
            const saga = await findSearchAlertSagaForUpdate(tx, input.ownerId, input.requestId);
            if (saga === null) {
              return searchAlertConflict("The search-alert preparation saga was not found.");
            }
            const evidence = await searchAlertEvidenceForUpdate(tx, saga, input.reviewEvidenceHash);
            assertSearchAlertIntent(input.intent, input.ownerId, input.requestId, "approved");
            const storedIntent = await getIdempotencyForUpdate(
              tx,
              input.intent.scope,
              input.intent.key,
            );
            if (storedIntent === null || !isDeepStrictEqual(storedIntent, input.intent)) {
              return searchAlertConflict(
                "The exact approved search-alert intent was not recorded.",
              );
            }
            assertSearchAlertIntentLive(storedIntent, input.now);
            assertSearchAlertDecision(
              input.decision,
              saga,
              evidence.body,
              input.intent,
              "approved",
              input.schedule,
            );
            if (
              input.schedule.ownerId !== saga.responseBody.ownerId ||
              input.schedule.id !== saga.responseBody.scheduleId ||
              input.schedule.savedSearchId !== saga.responseBody.savedSearchId ||
              input.schedule.deliveryEndpointId !== evidence.body.endpointId ||
              input.verifiedEndpointId !== evidence.body.endpointId ||
              input.expectedSavedSearchVersion !== evidence.body.savedSearchVersion
            ) {
              return searchAlertConflict("The approved search-alert activation has drifted.");
            }
            await getForUpdate<VerificationChallengeRecord>(
              tx,
              "verification_challenge",
              saga.responseBody.challengeId,
            );
            const result = await commitApprovedSearchAlertPostgres(tx, input);
            if (!(await finalizeSearchAlertPreparation(tx, saga, evidence))) {
              return searchAlertConflict("The search-alert preparation cleanup did not complete.");
            }
            return result;
          });
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as { readonly code?: unknown }).code === "23505"
          ) {
            throw domain("CONFLICT", "The search-alert approval conflicts with stored state.");
          }
          throw error;
        }
      },
      async decline(input) {
        try {
          return await sql.begin(async (transaction) => {
            const tx = transaction as PostgresExecutor;
            const saga = await findSearchAlertSagaForUpdate(tx, input.ownerId, input.requestId);
            if (saga === null) {
              return searchAlertConflict("The search-alert preparation saga was not found.");
            }
            assertSearchAlertSagaLive(saga, input.now);
            const evidence = await searchAlertEvidenceForUpdate(
              tx,
              saga,
              input.reviewEvidenceHash,
              { liveAt: input.now },
            );
            assertSearchAlertIntent(input.intent, input.ownerId, input.requestId, "declined");
            assertSearchAlertIntentLive(input.intent, input.now);
            assertSearchAlertDecision(
              input.decision,
              saga,
              evidence.body,
              input.intent,
              "declined",
              null,
            );
            await putExactIdempotencyRecord(tx, input.intent);
            const result = await putExactIdempotencyRecord(tx, input.decision);
            if (!(await finalizeSearchAlertPreparation(tx, saga, evidence))) {
              return searchAlertConflict("The search-alert preparation cleanup did not complete.");
            }
            return result;
          });
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as { readonly code?: unknown }).code === "23505"
          ) {
            throw domain("CONFLICT", "The search-alert decline conflicts with stored state.");
          }
          throw error;
        }
      },
      async expire(input) {
        if (
          searchAlertTimestampMs(input.reviewExpiresAt, "review expiry") >
          searchAlertTimestampMs(input.now, "current")
        ) {
          return searchAlertConflict("The search-alert review has not expired.");
        }
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const saga = await findSearchAlertSagaForUpdate(tx, input.ownerId, input.requestId);
          if (saga === null) return false;
          const storedEvidence = await getIdempotencyForUpdate(
            tx,
            `search_alert.request:${input.ownerId}`,
            input.requestId,
          );
          const evidence =
            storedEvidence === null
              ? null
              : await searchAlertEvidenceForUpdate(tx, saga, input.reviewEvidenceHash);
          if (evidence !== null && evidence.record.expiresAt !== input.reviewExpiresAt) {
            return searchAlertConflict("The search-alert review expiry has drifted.");
          }
          if (await exactCommittedSearchAlertApproval(tx, saga)) return false;
          if (await liveApprovedSearchAlertIntent(tx, saga, input.now)) {
            return false;
          }
          return finalizeSearchAlertPreparation(tx, saga, evidence);
        });
      },
      async compensate(input) {
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const stored = await getIdempotencyForUpdate(tx, input.saga.scope, input.saga.key);
          if (stored === null) return false;
          const saga = parseSearchAlertSaga(stored);
          if (!isDeepStrictEqual(saga, input.saga)) {
            return searchAlertConflict("The search-alert preparation saga identity has drifted.");
          }
          const evidence = await optionalSearchAlertEvidenceForUpdate(tx, saga);
          if (await exactCommittedSearchAlertApproval(tx, saga)) return false;
          if (await liveApprovedSearchAlertIntent(tx, saga, input.now)) {
            return false;
          }
          return finalizeSearchAlertPreparation(tx, saga, evidence);
        });
      },
      async purgeExpired(input) {
        if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
          throw new TypeError("Search-alert preparation purge limit must be between 1 and 1000.");
        }
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const rows = await tx<EntityRow[]>`
            SELECT saga.id, saga.owner_id, saga.body, saga.version
            FROM jobbbler.entity_records AS saga
            WHERE saga.kind = 'idempotency'
              AND left(saga.body->>'scope', ${"search_alert.request_saga:".length}) =
                'search_alert.request_saga:'
              AND saga.body->>'expiresAt' <= ${input.now}
              AND NOT EXISTS (
                SELECT 1
                FROM jobbbler.entity_records AS intent
                WHERE intent.kind = 'idempotency'
                  AND intent.body->>'scope' =
                    'search_alert.decision_intent:' ||
                    (saga.body->'responseBody'->>'ownerId')
                  AND intent.body->>'key' = saga.body->'responseBody'->>'requestId'
                  AND intent.body->>'responseStatus' = '202'
                  AND intent.body->>'requestHash' =
                    intent.body->'responseBody'->>'reviewBinding'
                  AND intent.body->'responseBody'->>'version' = '1'
                  AND intent.body->'responseBody'->>'status' = 'deciding'
                  AND intent.body->'responseBody'->>'requestId' =
                    saga.body->'responseBody'->>'requestId'
                  AND intent.body->'responseBody'->>'decision' = 'approved'
                  AND intent.body->'responseBody'->>'recordedAt' = intent.body->>'createdAt'
                  AND intent.body->>'expiresAt' > ${input.now}
                  AND (intent.body->>'expiresAt')::timestamptz >
                    (intent.body->>'createdAt')::timestamptz
                  AND (intent.body->>'expiresAt')::timestamptz <=
                    (intent.body->>'createdAt')::timestamptz + interval '24 hours'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM jobbbler.entity_records AS decision
                JOIN jobbbler.entity_records AS schedule
                  ON schedule.kind = 'schedule'
                 AND schedule.id = saga.body->'responseBody'->>'scheduleId'
                WHERE decision.kind = 'idempotency'
                  AND decision.body->>'scope' =
                    'search_alert.decision:' || (saga.body->'responseBody'->>'ownerId')
                  AND decision.body->>'key' = saga.body->'responseBody'->>'requestId'
                  AND decision.body->>'requestHash' =
                    decision.body->'responseBody'->'evidence'->>'reviewBinding'
                  AND decision.body->'responseBody'->'receipt'->>'requestId' =
                    saga.body->'responseBody'->>'requestId'
                  AND decision.body->'responseBody'->'receipt'->>'decision' = 'approved'
                  AND decision.body->'responseBody'->'receipt'->>'scheduleId' =
                    saga.body->'responseBody'->>'scheduleId'
                  AND decision.body->'responseBody'->'evidence'->>'savedSearchId' =
                    saga.body->'responseBody'->>'savedSearchId'
                  AND schedule.owner_id = saga.body->'responseBody'->>'ownerId'
                  AND schedule.body->>'savedSearchId' =
                    saga.body->'responseBody'->>'savedSearchId'
              )
            ORDER BY saga.body->>'expiresAt', saga.id
            FOR UPDATE OF saga SKIP LOCKED
            LIMIT ${input.limit}`;
          let removed = 0;
          for (const row of rows) {
            const saga = parseSearchAlertSaga(idempotencyFromEntity(row));
            const evidence = await optionalSearchAlertEvidenceForUpdate(tx, saga);
            if (await exactCommittedSearchAlertApproval(tx, saga)) continue;
            if (await liveApprovedSearchAlertIntent(tx, saga, input.now)) {
              continue;
            }
            if (await finalizeSearchAlertPreparation(tx, saga, evidence)) removed += 1;
          }
          return removed;
        });
      },
    },
    alerts: {
      async getLatestEvaluation(savedSearchId) {
        return (
          (await list<AlertEvaluationRecord>(sql, "alert_evaluation"))
            .filter((item) => item.savedSearchId === savedSearchId)
            .sort(
              (left, right) =>
                right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
            )[0] ?? null
        );
      },
      async insertEvaluation(input) {
        ensureUnique(input.evaluation.baseline, (item) => item.jobId, "Alert baseline job");
        ensureUnique(input.changes, (item) => item.id, "Alert change ID");
        ensureUnique(
          input.changes,
          (item) => `${item.jobId}\u0000${item.kind}`,
          "Alert change binding",
        );
        if (input.changes.some((change) => change.evaluationId !== input.evaluation.id)) {
          throw new TypeError("Alert changes must belong to the evaluation being inserted.");
        }
        await sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const schedule = await get<ScheduleRecord>(tx, "schedule", input.evaluation.scheduleId);
          if (
            schedule === null ||
            schedule.ownerId !== input.evaluation.ownerId ||
            schedule.savedSearchId !== input.evaluation.savedSearchId
          )
            throw domain(
              "VALIDATION",
              "Alert evaluation must match one owner-bound schedule and saved search.",
            );
          const jobIds = new Set([
            ...input.evaluation.baseline.map(({ jobId }) => jobId),
            ...input.changes.map(({ jobId }) => jobId),
          ]);
          for (const jobId of jobIds) {
            if ((await get<Job>(tx, "job", jobId)) === null) {
              throw domain(
                "VALIDATION",
                "Alert evaluations and changes must reference catalog jobs.",
              );
            }
          }
          await insert(tx, "alert_evaluation", input.evaluation, input.evaluation.ownerId);
          for (const change of input.changes) {
            await insert(tx, "alert_change", change, input.evaluation.ownerId);
          }
        });
        return input.evaluation;
      },
      async listChanges(evaluationId) {
        return (await list<AlertChangeRecord>(sql, "alert_change"))
          .filter((item) => item.evaluationId === evaluationId)
          .sort(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          );
      },
      async putDeliveryIfAbsent(record) {
        const candidates = await list<AlertDeliveryRecord>(sql, "alert_delivery", record.ownerId);
        const existing = candidates.find(
          (item) =>
            item.id === record.id ||
            (item.scheduleId === record.scheduleId &&
              item.evaluationId === record.evaluationId &&
              item.endpointId === record.endpointId &&
              item.contentHash === record.contentHash),
        );
        if (existing !== undefined) {
          if (
            existing.id === record.id &&
            (existing.contentHash !== record.contentHash ||
              existing.endpointId !== record.endpointId)
          )
            throw domain(
              "CONFLICT",
              "Notification delivery ID is already bound to different content.",
            );
          return { inserted: false, record: existing };
        }
        await insert(sql, "alert_delivery", record, record.ownerId);
        return { inserted: true, record };
      },
      async getDelivery(id) {
        return get<AlertDeliveryRecord>(sql, "alert_delivery", id);
      },
      async getLatestDelivery(scheduleId) {
        return (
          (await list<AlertDeliveryRecord>(sql, "alert_delivery"))
            .filter((item) => item.scheduleId === scheduleId)
            .sort(
              (left, right) =>
                right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
            )[0] ?? null
        );
      },
      async updateDelivery(input: AlertDeliveryUpdate, expectedVersion) {
        const current = await get<AlertDeliveryRecord>(sql, "alert_delivery", input.id);
        if (current === null) throw domain("NOT_FOUND", "Notification delivery was not found.");
        if (current.version !== expectedVersion)
          throw domain(
            "CONFLICT",
            "Notification delivery changed after it was read. Refresh and retry.",
          );
        const next = { ...current, ...input, version: current.version + 1 };
        await write(sql, "alert_delivery", next, next.ownerId, next.version);
        return next;
      },
    },
    rateLimits: {
      async check(input: RateLimitCheckInput): Promise<RateLimitDecision> {
        if (
          !Number.isSafeInteger(input.limit) ||
          input.limit < 1 ||
          !Number.isSafeInteger(input.windowMs) ||
          input.windowMs < 1 ||
          !Number.isSafeInteger(input.nowMs) ||
          input.nowMs < 0 ||
          input.key.trim().length === 0 ||
          input.key.length > 512
        )
          throw domain("VALIDATION", "Rate-limit input is invalid.");
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const rows = await tx<
            { readonly count: number; readonly reset_at_ms: string }[]
          >`SELECT count, reset_at_ms FROM jobbbler.rate_limit_windows WHERE key = ${input.key} FOR UPDATE`;
          const current = rows[0];
          const resetAtMs = input.nowMs + input.windowMs;
          if (current === undefined || Number(current.reset_at_ms) <= input.nowMs) {
            await tx`INSERT INTO jobbbler.rate_limit_windows(key, count, reset_at_ms) VALUES (${input.key}, 1, ${resetAtMs}) ON CONFLICT(key) DO UPDATE SET count = 1, reset_at_ms = EXCLUDED.reset_at_ms`;
            return { allowed: true, remaining: input.limit - 1, retryAfterSeconds: 0, resetAtMs };
          }
          if (current.count >= input.limit)
            return {
              allowed: false,
              remaining: 0,
              retryAfterSeconds: Math.max(
                1,
                Math.ceil((Number(current.reset_at_ms) - input.nowMs) / 1000),
              ),
              resetAtMs: Number(current.reset_at_ms),
            };
          await tx`UPDATE jobbbler.rate_limit_windows SET count = count + 1 WHERE key = ${input.key}`;
          return {
            allowed: true,
            remaining: input.limit - current.count - 1,
            retryAfterSeconds: 0,
            resetAtMs: Number(current.reset_at_ms),
          };
        });
      },
    },
    applications: {
      async insert(record) {
        return insert(sql, "application", record, record.ownerId);
      },
      async getById(id) {
        return get<ApplicationDraft>(sql, "application", id);
      },
      async getByOwner(id, ownerId) {
        const record = await get<ApplicationDraft>(sql, "application", id);
        return record?.ownerId === ownerId ? record : null;
      },
      async getByOwnerAndJob(ownerId, jobId) {
        return (
          (await list<ApplicationDraft>(sql, "application", ownerId))
            .filter((item) => item.jobId === jobId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
        );
      },
      async listByOwner(ownerId) {
        return (await list<ApplicationDraft>(sql, "application", ownerId)).sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
        );
      },
      async getLatestReview(draftId, ownerId) {
        return (
          (await list<ApplicationReviewRecord>(sql, "application_review", ownerId))
            .filter((item) => item.draftId === draftId)
            .sort(
              (left, right) =>
                right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
            )[0] ?? null
        );
      },
      async getLatestReceipt(draftId, ownerId) {
        return (
          (await list<ApplicationReceiptRecord>(sql, "application_receipt", ownerId))
            .filter((item) => item.draftId === draftId)
            .sort(
              (left, right) =>
                right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
            )[0] ?? null
        );
      },
      async getManagedDelivery(id, ownerId) {
        const record = await get<ManagedApplicationDeliveryRecord>(
          sql,
          "managed_application_delivery",
          id,
        );
        return record?.ownerId === ownerId ? record : null;
      },
      async applyMaterialEdit(input: MaterialApplicationEditInput) {
        if (
          input.draft.ownerId !== input.ownerId ||
          input.draft.version !== input.expectedVersion + 1
        )
          throw domain("VALIDATION", "Material edit must advance the owned draft by one version.");
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const current = await getForUpdate<ApplicationDraft>(tx, "application", input.draft.id);
          if (current?.ownerId !== input.ownerId || current.version !== input.expectedVersion)
            throw domain("CONFLICT", "Application draft changed before this material edit.");
          await write(tx, "application", input.draft, input.ownerId, input.draft.version);
          for (const review of await list<ApplicationReviewRecord>(
            tx,
            "application_review",
            input.ownerId,
          ))
            if (review.draftId === input.draft.id && review.status === "active")
              await write(
                tx,
                "application_review",
                { ...review, status: "invalidated" as const, invalidatedAt: input.now },
                input.ownerId,
              );
          for (const confirmation of await list<ApplicationConfirmationRecord>(
            tx,
            "application_confirmation",
            input.ownerId,
          ))
            if (confirmation.draftId === input.draft.id && confirmation.status === "active")
              await write(
                tx,
                "application_confirmation",
                { ...confirmation, status: "invalidated" as const },
                input.ownerId,
              );
          for (const grant of await list<RichDataGrantRecord>(tx, "rich_data_grant", input.ownerId))
            if (
              grant.draftId === input.draft.id &&
              (grant.status === "requested" || grant.status === "active")
            )
              await write(
                tx,
                "rich_data_grant",
                {
                  ...grant,
                  status: "withdrawn" as const,
                  withdrawnAt: input.now,
                  version: (grant.version ?? 0) + 1,
                },
                input.ownerId,
                (grant.version ?? 0) + 1,
              );
          return input.draft;
        });
      },
      async sealReview(input: SealApplicationReviewInput) {
        if (
          input.draft.ownerId !== input.ownerId ||
          input.draft.state !== "reviewed" ||
          input.draft.version !== input.expectedVersion + 1 ||
          input.review.ownerId !== input.ownerId ||
          input.review.draftId !== input.draft.id ||
          input.review.draftVersion !== input.draft.version ||
          input.review.status !== "active"
        )
          throw domain("VALIDATION", "Review must seal exactly the next owned draft version.");
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const current = await getForUpdate<ApplicationDraft>(tx, "application", input.draft.id);
          if (current?.ownerId !== input.ownerId || current.version !== input.expectedVersion)
            throw domain("CONFLICT", "Application draft changed before review sealing.");
          await write(tx, "application", input.draft, input.ownerId, input.draft.version);
          await insert(tx, "application_review", input.review, input.ownerId);
          return { draft: input.draft, review: input.review };
        });
      },
      async update(record, expectedVersion) {
        return updateVersioned(sql, "application", record, expectedVersion);
      },
      async insertReview(record) {
        const draft = await get<ApplicationDraft>(sql, "application", record.draftId);
        if (draft?.ownerId !== record.ownerId)
          throw domain("VALIDATION", "Review owner must own draft.");
        return insert(sql, "application_review", record, record.ownerId);
      },
      async getReview(id, ownerId) {
        const record = await get<ApplicationReviewRecord>(sql, "application_review", id);
        return record?.ownerId === ownerId ? record : null;
      },
      async invalidateReview(id, ownerId, invalidatedAt) {
        const current = await this.getReview(id, ownerId);
        if (current === null || current.status !== "active")
          throw domain("CONFLICT", "Review is not active for owner.");
        const next = { ...current, status: "invalidated" as const, invalidatedAt };
        await write(sql, "application_review", next, ownerId);
        return next;
      },
      async insertConfirmation(record) {
        const review = await get<ApplicationReviewRecord>(
          sql,
          "application_review",
          record.reviewId,
        );
        if (
          review === null ||
          review.ownerId !== record.ownerId ||
          review.draftId !== record.draftId ||
          review.payloadHash !== record.payloadHash ||
          review.status !== "active"
        )
          throw domain("VALIDATION", "Confirmation must bind an active owner review payload.");
        return insert(sql, "application_confirmation", record, record.ownerId);
      },
      async getConfirmation(id, ownerId) {
        const record = await get<ApplicationConfirmationRecord>(
          sql,
          "application_confirmation",
          id,
        );
        return record?.ownerId === ownerId ? record : null;
      },
      async invalidateConfirmation(id, ownerId) {
        const current = await this.getConfirmation(id, ownerId);
        if (current === null || current.status !== "active")
          throw domain("CONFLICT", "Confirmation is not active for owner.");
        const next = { ...current, status: "invalidated" as const };
        await write(sql, "application_confirmation", next, ownerId);
        return next;
      },
      async consumeConfirmation(id, ownerId, confirmationHash, consumedAt) {
        const current = await this.getConfirmation(id, ownerId);
        if (
          current === null ||
          current.status !== "active" ||
          current.confirmationHash !== confirmationHash ||
          current.expiresAt <= consumedAt
        )
          throw domain("CONFLICT", "Confirmation is invalid, expired, or already used.");
        const next = { ...current, status: "consumed" as const, consumedAt };
        await write(sql, "application_confirmation", next, ownerId);
        return next;
      },
      async completeSubmission(
        input: CompleteApplicationSubmissionInput,
      ): Promise<CompleteApplicationSubmissionResult> {
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const findExisting = async () =>
            (await list<ApplicationReceiptRecord>(tx, "application_receipt", input.ownerId)).find(
              (item) =>
                item.draftId === input.draftId &&
                item.idempotencyKey === input.receipt.idempotencyKey,
            );
          const resolveExisting = async (
            existing: ApplicationReceiptRecord,
            draft: ApplicationDraft,
            job: Job,
          ): Promise<CompleteApplicationSubmissionResult> => {
            if (
              existing.reviewId !== input.reviewId ||
              existing.confirmationId !== input.confirmationId ||
              existing.status !== "submitted" ||
              existing.externalUrl !== null ||
              existing.submission == null ||
              input.receipt.status !== "submitted"
            )
              throw domain("CONFLICT", "Idempotency key is bound to another submission.");
            if (
              !isDeepStrictEqual(input.delivery.role, { id: job.id, title: job.title }) ||
              !isDeepStrictEqual(input.receipt.submission.role, {
                id: job.id,
                title: job.title,
              })
            )
              throw domain(
                "VALIDATION",
                "Submission receipt must bind the transaction-bound role snapshot.",
              );
            const delivery = await getForUpdate<ManagedApplicationDeliveryRecord>(
              tx,
              "managed_application_delivery",
              existing.submission.managedDeliveryId,
            );
            if (
              delivery?.ownerId !== input.ownerId ||
              delivery.status !== "acknowledged" ||
              delivery.providerReferenceId !== existing.submission.providerReferenceId ||
              !isDeepStrictEqual(delivery.role, { id: job.id, title: job.title }) ||
              !isDeepStrictEqual(existing.submission.role, delivery.role)
            )
              throw domain(
                "CONFLICT",
                "The persisted submission is missing its delivery acknowledgement.",
              );
            return { draft, receipt: existing, delivery, inserted: false };
          };
          let existing = await findExisting();
          if (existing !== undefined) {
            const draft = await getForUpdate<ApplicationDraft>(tx, "application", input.draftId);
            if (draft?.ownerId !== input.ownerId)
              throw domain("CONFLICT", "Application draft is unavailable for owner.");
            const job = await getForUpdate<Job>(tx, "job", draft.jobId);
            if (job === null) throw domain("CONFLICT", "Application role is unavailable.");
            return resolveExisting(existing, draft, job);
          }
          const draft = await getForUpdate<ApplicationDraft>(tx, "application", input.draftId);
          if (draft?.ownerId !== input.ownerId)
            throw domain("CONFLICT", "Application draft is unavailable for owner.");
          const job = await getForUpdate<Job>(tx, "job", draft.jobId);
          if (job === null) throw domain("CONFLICT", "Application role is unavailable.");
          existing = await findExisting();
          if (existing !== undefined) {
            return resolveExisting(existing, draft, job);
          }
          if (draft.version !== input.expectedDraftVersion || draft.state !== "reviewed")
            throw domain("CONFLICT", "A current reviewed draft is required.");
          if (job.status !== "open") throw domain("CONFLICT", "Role closed — nothing submitted.");
          if (input.decisionChannel === "first_party_ui") {
            const delegations = await listByOwnerDraft<AgentDelegationRecord>(
              tx,
              "delegation",
              input.ownerId,
              "resourceId",
              input.draftId,
            );
            if (requiresAgentClientSubmissionDecision(draft, delegations, input.now)) {
              throw domain(
                "FORBIDDEN",
                "Complete consent and submission decisions for this agent-assisted draft in the external agent client.",
              );
            }
          }
          const review = await getForUpdate<ApplicationReviewRecord>(
            tx,
            "application_review",
            input.reviewId,
          );
          if (
            review?.ownerId !== input.ownerId ||
            review.draftId !== input.draftId ||
            review.draftVersion !== input.expectedDraftVersion ||
            review.payloadHash !== input.reviewPayloadHash ||
            review.status !== "active"
          )
            throw domain("CONFLICT", "A current immutable review is required.");
          const confirmation = await getForUpdate<ApplicationConfirmationRecord>(
            tx,
            "application_confirmation",
            input.confirmationId,
          );
          if (
            confirmation?.ownerId !== input.ownerId ||
            confirmation.draftId !== input.draftId ||
            confirmation.reviewId !== input.reviewId ||
            confirmation.payloadHash !== input.reviewPayloadHash ||
            confirmation.confirmationHash !== input.confirmationHash ||
            confirmation.status !== "active" ||
            confirmation.expiresAt <= input.now
          )
            throw domain("CONFLICT", "A live matching confirmation is required.");
          const grant = await getForUpdate<RichDataGrantRecord>(
            tx,
            "rich_data_grant",
            input.grant.id,
          );
          if (
            input.grant.payloadHash !== input.reviewPayloadHash ||
            grant?.ownerId !== input.ownerId ||
            grant.draftId !== input.draftId ||
            (grant.version ?? 0) !== input.grant.version ||
            grant.status !== "active" ||
            grant.expiresAt <= input.now ||
            grant.recipientId !== input.grant.recipientId ||
            grant.purpose !== input.grant.purpose ||
            grant.payloadHash !== input.grant.payloadHash ||
            grant.noticeVersion !== input.grant.noticeVersion ||
            grant.legalBasis !== input.grant.legalBasis ||
            stableHash(grant.categories) !== stableHash(input.grant.categories) ||
            stableHash(grant.fieldKeys) !== stableHash(input.grant.fieldKeys) ||
            stableHash(grant.documentIds) !== stableHash(input.grant.documentIds)
          )
            throw domain("CONFLICT", "An exact active data grant is required.");
          if (
            job.applyMode !== "internal" ||
            job.source.key !== "jobbbler_demo" ||
            job.source.url !== null ||
            job.organizationId !== input.delivery.recipientId ||
            job.organizationName !== input.delivery.recipientName
          )
            throw domain(
              "CONFLICT",
              "Managed submission delivery is limited to a first-party demo recipient.",
            );
          if (
            input.receipt.ownerId !== input.ownerId ||
            input.receipt.draftId !== input.draftId ||
            input.receipt.reviewId !== input.reviewId ||
            input.receipt.confirmationId !== input.confirmationId ||
            input.receipt.status !== "submitted" ||
            input.receipt.externalUrl !== null ||
            input.receipt.createdAt !== input.now
          )
            throw domain("VALIDATION", "Submission receipt must bind a safe exact submission.");
          const submission = input.receipt.submission;
          if (
            input.delivery.ownerId !== input.ownerId ||
            input.delivery.draftId !== input.draftId ||
            input.delivery.reviewId !== input.reviewId ||
            input.delivery.confirmationId !== input.confirmationId ||
            input.delivery.idempotencyKey !== input.receipt.idempotencyKey ||
            input.delivery.provider !== "jobbbler_demo" ||
            input.delivery.providerReferenceId.trim().length === 0 ||
            !isDeepStrictEqual(input.delivery.role, { id: job.id, title: job.title }) ||
            input.delivery.recipientId !== input.grant.recipientId ||
            input.delivery.recipientName.trim().length === 0 ||
            input.delivery.payloadHash !== input.reviewPayloadHash ||
            input.delivery.status !== "acknowledged" ||
            input.delivery.acknowledgedAt !== input.now ||
            input.delivery.createdAt !== input.now ||
            input.delivery.fields.length === 0 ||
            !isDeepStrictEqual(
              input.delivery.fields.map(({ fieldKey }) => fieldKey),
              input.grant.fieldKeys,
            ) ||
            submission.managedDeliveryId !== input.delivery.id ||
            submission.provider !== input.delivery.provider ||
            submission.providerReferenceId !== input.delivery.providerReferenceId ||
            !isDeepStrictEqual(submission.role, input.delivery.role) ||
            submission.recipientId !== input.delivery.recipientId ||
            submission.recipientName !== input.delivery.recipientName ||
            submission.submittedAt !== input.delivery.acknowledgedAt ||
            !isDeepStrictEqual(submission.fields, input.delivery.fields)
          )
            throw domain(
              "VALIDATION",
              "Managed delivery must acknowledge the exact immutable submission.",
            );
          const acknowledged = await tx<EntityRow[]>`
            INSERT INTO jobbbler.entity_records(
              kind, id, owner_id, body, version, created_at, updated_at
            ) VALUES (
              'managed_application_delivery', ${input.delivery.id}, ${input.ownerId},
              ${tx.json(input.delivery as unknown as postgres.JSONValue)}, 0,
              ${timestamp(input.delivery.createdAt)},
              ${timestamp(input.delivery.acknowledgedAt)}
            )
            ON CONFLICT DO NOTHING
            RETURNING id, owner_id, body, version`;
          if (acknowledged[0] === undefined)
            throw domain("CONFLICT", "Managed delivery was not acknowledged.");
          const delivery = body<ManagedApplicationDeliveryRecord>(acknowledged[0]);
          if (delivery.status !== "acknowledged")
            throw domain("CONFLICT", "Managed delivery was not acknowledged.");
          const consumed = { ...confirmation, status: "consumed" as const, consumedAt: input.now };
          const submitted = {
            ...draft,
            state: input.receipt.status,
            version: draft.version + 1,
            updatedAt: input.now,
          };
          await write(tx, "application_confirmation", consumed, input.ownerId);
          await write(tx, "application", submitted, input.ownerId, submitted.version);
          await insert(tx, "application_receipt", input.receipt, input.ownerId);
          return { draft: submitted, receipt: input.receipt, delivery, inserted: true };
        });
      },
    },
    delegations: {
      async insert(record) {
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const draft = await getForUpdate<ApplicationDraft>(tx, "application", record.resourceId);
          if (
            draft?.ownerId !== record.ownerId ||
            draft.state === "submitted" ||
            draft.state === "handed_off"
          ) {
            throw domain(
              "CONFLICT",
              "Application assistance requires a current nonterminal owned draft.",
            );
          }
          const session = await get<AgentSessionRecord>(tx, "agent_session", record.agentSessionId);
          if (session?.ownerId !== record.ownerId || session.draftId !== record.resourceId) {
            throw domain(
              "VALIDATION",
              "Delegation must bind an agent session for the same owner and application draft.",
            );
          }
          return insert(tx, "delegation", record, record.ownerId);
        });
      },
      async getById(id, ownerId) {
        const record = await get<AgentDelegationRecord>(sql, "delegation", id);
        return record?.ownerId === ownerId ? record : null;
      },
      async listByResource(ownerId, resourceId) {
        return listByOwnerDraft<AgentDelegationRecord>(
          sql,
          "delegation",
          ownerId,
          "resourceId",
          resourceId,
        );
      },
      async getActiveMatch(input: ActiveDelegationMatchInput) {
        const rows = await sql<EntityRow[]>`
          SELECT delegation.id, delegation.owner_id, delegation.body, delegation.version
          FROM jobbbler.entity_records AS delegation
          INNER JOIN jobbbler.entity_records AS session
            ON session.kind = 'agent_session'
           AND session.id = delegation.body->>'agentSessionId'
           AND session.owner_id = delegation.owner_id
           AND session.body->>'draftId' = delegation.body->>'resourceId'
          WHERE delegation.kind = 'delegation'
            AND delegation.owner_id = ${input.ownerId}
            AND delegation.body->>'agentSessionId' = ${input.agentSessionId}
            AND delegation.body->>'resourceType' = ${input.resourceType}
            AND delegation.body->>'resourceId' = ${input.resourceId}
            AND delegation.body->>'status' = 'active'
            AND delegation.body->>'expiresAt' > ${input.now}
            AND session.body->>'revokedAt' IS NULL
            AND session.body->>'expiresAt' > ${input.now}
            AND delegation.body->'operations' ? ${input.operation}
          ORDER BY delegation.body->>'approvedAt' DESC NULLS LAST,
                   delegation.created_at DESC,
                   delegation.id
          LIMIT 1`;
        return rows[0] === undefined ? null : body<AgentDelegationRecord>(rows[0]);
      },
      async approve(id, ownerId, approvedAt, evidence) {
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const current = await getForUpdate<AgentDelegationRecord>(tx, "delegation", id);
          if (
            current?.ownerId !== ownerId ||
            current.status !== "requested" ||
            current.expiresAt <= approvedAt
          )
            throw domain(
              "CONFLICT",
              "Delegation is unavailable, expired, or not awaiting approval.",
            );
          const next = {
            ...current,
            status: "active" as const,
            approvedAt,
            decisionChannel: evidence?.channel ?? null,
            decisionRequestId: evidence?.requestId ?? null,
            decisionAction: evidence?.action ?? null,
            decisionEvidenceVersion: evidence?.evidenceVersion ?? null,
          };
          await write(tx, "delegation", next, ownerId);
          return next;
        });
      },
      async revoke(id, ownerId, revokedAt, evidence) {
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const current = await getForUpdate<AgentDelegationRecord>(tx, "delegation", id);
          if (current?.ownerId !== ownerId)
            throw domain("CONFLICT", "Delegation is not available for owner.");
          if (current.status === "revoked") return current;
          if (current.status !== "requested" && current.status !== "active")
            throw domain("CONFLICT", "Delegation is not revocable for owner.");
          const next = {
            ...current,
            status: "revoked" as const,
            revokedAt,
            decisionChannel: evidence?.channel ?? null,
            decisionRequestId: evidence?.requestId ?? null,
            decisionAction: evidence?.action ?? null,
            decisionEvidenceVersion: evidence?.evidenceVersion ?? null,
          };
          await write(tx, "delegation", next, ownerId);
          return next;
        });
      },
    },
    dataGrants: {
      async insert(record) {
        return insert(sql, "data_grant", record, record.ownerId);
      },
      async getById(id, ownerId) {
        const record = await get<DataGrantRecord>(sql, "data_grant", id);
        return record?.ownerId === ownerId ? record : null;
      },
      async approve(id, ownerId, approvedAt) {
        const current = await this.getById(id, ownerId);
        if (current === null || current.status !== "requested")
          throw domain("CONFLICT", "Data grant is not requested for owner.");
        const next = { ...current, status: "active" as const, approvedAt };
        await write(sql, "data_grant", next, ownerId);
        return next;
      },
      async withdraw(id, ownerId, withdrawnAt) {
        const current = await this.getById(id, ownerId);
        if (current === null || current.status !== "active")
          throw domain("CONFLICT", "Data grant is not active for owner.");
        const next = { ...current, status: "withdrawn" as const, withdrawnAt };
        await write(sql, "data_grant", next, ownerId);
        return next;
      },
    },
    agentSessions: {
      async insert(record: AgentSessionRecord) {
        assertTokenHash(record.tokenHash);
        await assertDraftOwnership(sql, record.ownerId, record.draftId);
        return insert(sql, "agent_session", record, record.ownerId);
      },
      async getById(id, ownerId, draftId) {
        const record = await get<AgentSessionRecord>(sql, "agent_session", id);
        return record?.ownerId === ownerId && record.draftId === draftId ? record : null;
      },
      async resolve(input: ResolveAgentSessionInput) {
        return (
          (await list<AgentSessionRecord>(sql, "agent_session", input.ownerId)).find(
            (record) =>
              record.draftId === input.draftId &&
              record.tokenHash === input.tokenHash &&
              record.revokedAt === null &&
              record.expiresAt > input.now,
          ) ?? null
        );
      },
      async revoke(id, ownerId, draftId, revokedAt) {
        const current = await this.getById(id, ownerId, draftId);
        if (current === null || current.revokedAt !== null)
          throw domain("CONFLICT", "Agent session is not active for owner and draft.");
        const next = { ...current, revokedAt };
        await write(sql, "agent_session", next, ownerId);
        return next;
      },
    },
    richDataGrants: {
      async insert(record: RichDataGrantRecord, now: string) {
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          await assertDraftOwnership(tx, record.ownerId, record.draftId);
          const expired = (
            await listByOwnerDraft<RichDataGrantRecord>(
              tx,
              "rich_data_grant",
              record.ownerId,
              "draftId",
              record.draftId,
            )
          )
            .filter(
              (candidate) =>
                (candidate.status === "requested" || candidate.status === "active") &&
                candidate.expiresAt <= now &&
                sameRichDataGrantScope(candidate, record),
            )
            .sort((left, right) => left.id.localeCompare(right.id));
          let retired = false;
          for (const candidate of expired) {
            const current = await getForUpdate<RichDataGrantRecord>(
              tx,
              "rich_data_grant",
              candidate.id,
            );
            if (
              current !== null &&
              (current.status === "requested" || current.status === "active") &&
              current.expiresAt <= now &&
              sameRichDataGrantScope(current, record)
            ) {
              const next = {
                ...current,
                status: "withdrawn" as const,
                withdrawnAt: now,
                version: (current.version ?? 0) + 1,
              };
              await write(tx, "rich_data_grant", next, record.ownerId, next.version);
              retired = true;
            }
          }
          if (retired) {
            await tx`UPDATE jobbbler.entity_records SET body = jsonb_set(body, '{status}', '"invalidated"'::jsonb), updated_at = now() WHERE kind = 'application_confirmation' AND owner_id = ${record.ownerId} AND body->>'draftId' = ${record.draftId} AND body->>'status' = 'active'`;
          }
          const stored = { ...record, version: 0 };
          return insert(tx, "rich_data_grant", stored, stored.ownerId);
        });
      },
      async getById(id, ownerId, draftId) {
        const record = await get<RichDataGrantRecord>(sql, "rich_data_grant", id);
        return record?.ownerId === ownerId && record.draftId === draftId ? record : null;
      },
      async listByDraft(ownerId, draftId) {
        return listByOwnerDraft<RichDataGrantRecord>(
          sql,
          "rich_data_grant",
          ownerId,
          "draftId",
          draftId,
        );
      },
      async getCurrent(input: RichDataGrantMatchInput) {
        return (
          (await list<RichDataGrantRecord>(sql, "rich_data_grant", input.ownerId)).find(
            (record) =>
              record.draftId === input.draftId &&
              record.recipientId === input.recipientId &&
              record.purpose === input.purpose &&
              record.payloadHash === input.payloadHash &&
              record.noticeVersion === input.noticeVersion &&
              record.legalBasis === input.legalBasis &&
              record.status === "active" &&
              record.expiresAt > input.now &&
              stableHash(record.categories) === stableHash(input.categories) &&
              stableHash(record.fieldKeys) === stableHash(input.fieldKeys) &&
              stableHash(record.documentIds) === stableHash(input.documentIds),
          ) ?? null
        );
      },
      async approveCurrent(input: ApproveRichDataGrantInput) {
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const grant = await getForUpdate<RichDataGrantRecord>(tx, "rich_data_grant", input.id);
          const draft = await getForUpdate<ApplicationDraft>(tx, "application", input.draftId);
          const job = draft === null ? null : await getForUpdate<Job>(tx, "job", draft.jobId);
          const review = await getForUpdate<ApplicationReviewRecord>(
            tx,
            "application_review",
            input.reviewId,
          );
          const latestReview =
            (await list<ApplicationReviewRecord>(tx, "application_review", input.ownerId))
              .filter((item) => item.draftId === input.draftId)
              .sort(
                (left, right) =>
                  right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
              )[0] ?? null;
          if (
            grant?.ownerId !== input.ownerId ||
            grant.draftId !== input.draftId ||
            grant.status !== "requested" ||
            (grant.version ?? 0) !== input.expectedGrantVersion ||
            grant.expiresAt <= input.at ||
            draft?.ownerId !== input.ownerId ||
            draft.version !== input.expectedDraftVersion ||
            draft.state !== "reviewed" ||
            draft.jobId !== input.jobId ||
            job?.organizationId !== input.jobOrganizationId ||
            job.organizationName !== input.jobOrganizationName ||
            job.applyMode !== input.jobApplyMode ||
            review?.ownerId !== input.ownerId ||
            review.draftId !== input.draftId ||
            latestReview?.id !== review.id ||
            review.status !== "active" ||
            review.draftVersion !== input.expectedDraftVersion ||
            review.payloadHash !== input.reviewPayloadHash
          )
            throw domain(
              "CONFLICT",
              "The data grant no longer matches the current reviewed disclosure.",
            );
          const next = {
            ...grant,
            status: "active" as const,
            approvedAt: input.at,
            approvalChannel: input.approvalEvidence?.channel ?? null,
            approvalRequestId: input.approvalEvidence?.requestId ?? null,
            affirmativeAction: input.approvalEvidence?.affirmativeAction ?? null,
            approvalEvidenceVersion: input.approvalEvidence?.evidenceVersion ?? null,
            version: (grant.version ?? 0) + 1,
          };
          await write(tx, "rich_data_grant", next, input.ownerId, next.version);
          return next;
        });
      },
      async approve(id, ownerId, draftId, at) {
        const current = await this.getById(id, ownerId, draftId);
        if (current === null || current.status !== "requested" || current.expiresAt <= at)
          throw domain("CONFLICT", "Data grant is unavailable, expired, or not awaiting approval.");
        const next = {
          ...current,
          status: "active" as const,
          approvedAt: at,
          version: (current.version ?? 0) + 1,
        };
        await write(sql, "rich_data_grant", next, ownerId, next.version);
        return next;
      },
      async withdraw(id, ownerId, draftId, at, evidence) {
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const current = await getForUpdate<RichDataGrantRecord>(tx, "rich_data_grant", id);
          if (current?.ownerId !== ownerId || current.draftId !== draftId)
            throw domain("CONFLICT", "Data grant is not available for owner and draft.");
          if (current.status === "withdrawn") return current;
          if (current.status !== "requested" && current.status !== "active")
            throw domain("CONFLICT", "Data grant is not withdrawable for owner and draft.");
          const next = {
            ...current,
            status: "withdrawn" as const,
            withdrawnAt: at,
            withdrawalChannel: evidence?.channel ?? null,
            withdrawalRequestId: evidence?.requestId ?? null,
            withdrawalAction: evidence?.action ?? null,
            withdrawalEvidenceVersion: evidence?.evidenceVersion ?? null,
            version: (current.version ?? 0) + 1,
          };
          await write(tx, "rich_data_grant", next, ownerId, next.version);
          await tx`UPDATE jobbbler.entity_records SET body = jsonb_set(body, '{status}', '"invalidated"'::jsonb), updated_at = now() WHERE kind = 'application_confirmation' AND owner_id = ${ownerId} AND body->>'draftId' = ${draftId} AND body->>'status' = 'active'`;
          return next;
        });
      },
    },
    workItems: {
      async insert(record) {
        return insert(sql, "work_item", record);
      },
      async putIfAbsent(record) {
        const existing = await get<WorkItemRecord>(sql, "work_item", record.id);
        if (existing === null) {
          await insert(sql, "work_item", record);
          return { inserted: true, record };
        }
        if (
          existing.kind !== record.kind ||
          stableHash(existing.payload) !== stableHash(record.payload) ||
          existing.maxAttempts !== record.maxAttempts
        )
          throw domain("CONFLICT", "Work-item ID is already bound to a different task.");
        return { inserted: false, record: existing };
      },
      async getById(id) {
        return get<WorkItemRecord>(sql, "work_item", id);
      },
      async claimDue(input) {
        const kinds = validateKinds(input.kinds);
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const ids =
            kinds.length === 0
              ? await tx<
                  { readonly id: string }[]
                >`SELECT id FROM jobbbler.entity_records WHERE kind = 'work_item' AND (body->>'attempt')::int < (body->>'maxAttempts')::int AND ((body->>'status' IN ('pending','failed') AND body->>'availableAt' <= ${input.now}) OR (body->>'status' = 'running' AND body->>'leaseExpiresAt' <= ${input.now})) ORDER BY body->>'availableAt', id FOR UPDATE SKIP LOCKED LIMIT ${input.limit}`
              : await tx<
                  { readonly id: string }[]
                >`SELECT id FROM jobbbler.entity_records WHERE kind = 'work_item' AND body->>'kind' = ANY(${tx.array([...kinds])}) AND (body->>'attempt')::int < (body->>'maxAttempts')::int AND ((body->>'status' IN ('pending','failed') AND body->>'availableAt' <= ${input.now}) OR (body->>'status' = 'running' AND body->>'leaseExpiresAt' <= ${input.now})) ORDER BY body->>'availableAt', id FOR UPDATE SKIP LOCKED LIMIT ${input.limit}`;
          const claimed: WorkItemRecord[] = [];
          for (const { id } of ids) {
            const current = await get<WorkItemRecord>(tx, "work_item", id);
            if (current === null) continue;
            const next = {
              ...current,
              status: "running" as const,
              attempt: current.attempt + 1,
              leaseOwner: input.workerId,
              leaseExpiresAt: input.leaseExpiresAt,
              updatedAt: input.now,
            };
            await write(tx, "work_item", next);
            claimed.push(next);
          }
          return claimed;
        });
      },
      async renewLease(input) {
        const rows = await sql<EntityRow[]>`
          UPDATE jobbbler.entity_records
          SET body = body || ${sql.json({
            leaseExpiresAt: input.leaseExpiresAt,
            updatedAt: input.now,
          })}::jsonb,
              updated_at = ${input.now}
          WHERE kind = 'work_item'
            AND id = ${input.id}
            AND body->>'status' = 'running'
            AND body->>'leaseOwner' = ${input.workerId}
            AND body->>'leaseExpiresAt' > ${input.now}
            AND body->>'leaseExpiresAt' < ${input.leaseExpiresAt}
          RETURNING id, owner_id, body, version`;
        return requireWorkItemMutation(sql, input.id, rows);
      },
      async complete(id, workerId, now) {
        const rows = await sql<EntityRow[]>`
          UPDATE jobbbler.entity_records
          SET body = body || ${sql.json({
            status: "succeeded",
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            updatedAt: now,
          })}::jsonb,
              updated_at = ${now}
          WHERE kind = 'work_item'
            AND id = ${id}
            AND body->>'status' = 'running'
            AND body->>'leaseOwner' = ${workerId}
            AND body->>'leaseExpiresAt' > ${now}
          RETURNING id, owner_id, body, version`;
        return requireWorkItemMutation(sql, id, rows);
      },
      async fail(input) {
        const rows = await sql<EntityRow[]>`
          UPDATE jobbbler.entity_records
          SET body = body || jsonb_build_object(
                'status', CASE
                  WHEN ${input.terminal} OR (body->>'attempt')::integer >= (body->>'maxAttempts')::integer
                    THEN 'dead'
                  ELSE 'failed'
                END,
                'availableAt', CASE
                  WHEN ${input.terminal} OR (body->>'attempt')::integer >= (body->>'maxAttempts')::integer
                    THEN ${input.now}
                  ELSE ${input.retryAt}
                END,
                'leaseOwner', NULL,
                'leaseExpiresAt', NULL,
                'lastErrorCode', ${input.errorCode}::text,
                'updatedAt', ${input.now}::text
              ),
              updated_at = ${input.now}
          WHERE kind = 'work_item'
            AND id = ${input.id}
            AND body->>'status' = 'running'
            AND body->>'leaseOwner' = ${input.workerId}
            AND body->>'leaseExpiresAt' > ${input.now}
          RETURNING id, owner_id, body, version`;
        return requireWorkItemMutation(sql, input.id, rows);
      },
    },
    audit: {
      async append(record) {
        return insert(sql, "audit", record);
      },
      async listForAggregate(aggregateType, aggregateId, limit) {
        return (await list<AuditEventRecord>(sql, "audit"))
          .filter(
            (item) => item.aggregateType === aggregateType && item.aggregateId === aggregateId,
          )
          .sort(
            (left, right) =>
              left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
          )
          .slice(0, limit);
      },
    },
    ownerActivity: {
      async append(record) {
        const owner = await get<OwnerRecord>(sql, "owner", record.ownerId);
        if (owner === null) throw domain("VALIDATION", "Activity owner was not found.");
        const event = ownerActivityEventSchema.parse(record.event);
        const rows = await sql<{ readonly sequence: string }[]>`
          INSERT INTO jobbbler.owner_activity_events(
            id, owner_id, schema_version, kind, activity_key, status, safe_summary,
            correlation_id, actor_kind, aggregate_type, aggregate_version, occurred_at, effects
          ) VALUES (
            ${event.id}, ${record.ownerId}, ${event.schemaVersion}, ${event.kind}, ${event.key},
            ${event.status}, ${event.safeSummary}, ${event.correlationId}, ${event.actorKind},
            ${event.aggregate.type}, ${event.aggregate.version}, ${event.occurredAt},
            ${sql.json(event.effects)}
          )
          RETURNING sequence::text`;
        const sequence = Number(rows[0]?.sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 1) {
          throw domain("VALIDATION", "Stored activity cursor sequence is invalid.");
        }
        return { sequence, ownerId: record.ownerId, event };
      },
      async clear(ownerId, actorKind) {
        const rows =
          actorKind === undefined
            ? await sql<{ readonly sequence: string }[]>`
                DELETE FROM jobbbler.owner_activity_events
                WHERE owner_id = ${ownerId}
                RETURNING sequence::text`
            : await sql<{ readonly sequence: string }[]>`
                DELETE FROM jobbbler.owner_activity_events
                WHERE owner_id = ${ownerId} AND actor_kind = ${actorKind}
                RETURNING sequence::text`;
        return rows.length;
      },
      async listWindow(input) {
        if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
          throw domain("VALIDATION", "Activity window limit must be between 1 and 100.");
        }
        if (
          input.afterSequence !== null &&
          (!Number.isSafeInteger(input.afterSequence) || input.afterSequence < 0)
        ) {
          throw domain("VALIDATION", "Activity cursor is invalid.");
        }
        const latestRows =
          input.actorKind === undefined
            ? await sql<{ readonly sequence: string }[]>`
                SELECT coalesce(max(sequence), 0)::text AS sequence
                FROM jobbbler.owner_activity_events
                WHERE owner_id = ${input.ownerId}`
            : await sql<{ readonly sequence: string }[]>`
                SELECT coalesce(max(sequence), 0)::text AS sequence
                FROM jobbbler.owner_activity_events
                WHERE owner_id = ${input.ownerId} AND actor_kind = ${input.actorKind}`;
        const latestSequence = Number(latestRows[0]?.sequence ?? "0");
        if (!Number.isSafeInteger(latestSequence) || latestSequence < 0) {
          throw domain("VALIDATION", "Stored activity cursor sequence is invalid.");
        }
        if (input.afterSequence === null) {
          const rows =
            input.actorKind === undefined
              ? await sql<OwnerActivityRow[]>`
                  SELECT sequence::text, id, owner_id, schema_version, kind, activity_key, status,
                         safe_summary, correlation_id, actor_kind, aggregate_type,
                         aggregate_version,
                         to_char(
                           occurred_at AT TIME ZONE 'UTC',
                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                         ) AS occurred_at,
                         effects
                  FROM jobbbler.owner_activity_events
                  WHERE owner_id = ${input.ownerId}
                  ORDER BY sequence DESC
                  LIMIT ${input.limit}`
              : await sql<OwnerActivityRow[]>`
                  SELECT sequence::text, id, owner_id, schema_version, kind, activity_key, status,
                         safe_summary, correlation_id, actor_kind, aggregate_type,
                         aggregate_version,
                         to_char(
                           occurred_at AT TIME ZONE 'UTC',
                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                         ) AS occurred_at,
                         effects
                  FROM jobbbler.owner_activity_events
                  WHERE owner_id = ${input.ownerId} AND actor_kind = ${input.actorKind}
                  ORDER BY sequence DESC
                  LIMIT ${input.limit}`;
          return {
            events: rows.reverse().map(ownerActivityFromRow),
            hasMore: false,
            latestSequence,
          };
        }
        const rows =
          input.actorKind === undefined
            ? await sql<OwnerActivityRow[]>`
                SELECT sequence::text, id, owner_id, schema_version, kind, activity_key, status,
                       safe_summary, correlation_id, actor_kind, aggregate_type, aggregate_version,
                       to_char(
                         occurred_at AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                       ) AS occurred_at,
                       effects
                FROM jobbbler.owner_activity_events
                WHERE owner_id = ${input.ownerId} AND sequence > ${input.afterSequence}
                ORDER BY sequence
                LIMIT ${input.limit + 1}`
            : await sql<OwnerActivityRow[]>`
                SELECT sequence::text, id, owner_id, schema_version, kind, activity_key, status,
                       safe_summary, correlation_id, actor_kind, aggregate_type, aggregate_version,
                       to_char(
                         occurred_at AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                       ) AS occurred_at,
                       effects
                FROM jobbbler.owner_activity_events
                WHERE owner_id = ${input.ownerId} AND actor_kind = ${input.actorKind}
                  AND sequence > ${input.afterSequence}
                ORDER BY sequence
                LIMIT ${input.limit + 1}`;
        return {
          events: rows.slice(0, input.limit).map(ownerActivityFromRow),
          hasMore: rows.length > input.limit,
          latestSequence,
        };
      },
    },
    idempotency: {
      async putIfAbsent(record) {
        const id = `${record.scope}:${record.key}`;
        const candidate = { ...record, id };
        const inserted = await sql<EntityRow[]>`
          INSERT INTO jobbbler.entity_records
            (kind, id, owner_id, body, version, created_at, updated_at)
          VALUES (
            'idempotency', ${id}, NULL, ${sql.json(candidate as postgres.JSONValue)}, 0,
            ${record.createdAt}, ${record.createdAt}
          )
          ON CONFLICT (kind, id) DO NOTHING
          RETURNING id, owner_id, body, version`;
        if (inserted[0] !== undefined) return { inserted: true, record };
        const current = await get<IdempotencyRecord & { readonly id: string }>(
          sql,
          "idempotency",
          id,
        );
        if (current === null) {
          throw domain("CONFLICT", "The idempotency key claim could not be resolved.");
        }
        if (current.requestHash !== record.requestHash)
          throw domain("CONFLICT", "The idempotency key is already bound to a different request.");
        const { id: _id, ...stored } = current;
        return { inserted: false, record: stored };
      },
      async get(scope, key) {
        const current = await get<IdempotencyRecord & { readonly id: string }>(
          sql,
          "idempotency",
          `${scope}:${key}`,
        );
        if (current === null) return null;
        const { id: _id, ...record } = current;
        return record;
      },
      async deleteExact(input) {
        const rows = await sql<{ readonly id: string }[]>`
          DELETE FROM jobbbler.entity_records
          WHERE kind = 'idempotency'
            AND id = ${`${input.scope}:${input.key}`}
            AND body->>'requestHash' = ${input.requestHash}
            AND body->'responseBody' = ${sql.json(input.responseBody as postgres.JSONValue)}
          RETURNING id`;
        return rows[0] !== undefined;
      },
      async purgeExpired(input) {
        if (
          input.scopePrefix.length === 0 ||
          input.scopePrefix.length > 128 ||
          !Number.isSafeInteger(input.limit) ||
          input.limit < 1 ||
          input.limit > 1_000
        ) {
          throw new TypeError(
            "Idempotency purge requires a scope prefix and limit from 1 to 1000.",
          );
        }
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const expired = await tx<{ readonly id: string }[]>`
            SELECT id
            FROM jobbbler.entity_records
            WHERE kind = 'idempotency'
              AND left(body->>'scope', ${input.scopePrefix.length}) = ${input.scopePrefix}
              AND body->>'expiresAt' <= ${input.now}
              AND left(body->>'scope', length('search_alert.request_saga:'))
                <> 'search_alert.request_saga:'
              AND left(body->>'scope', length('search_alert.request:'))
                <> 'search_alert.request:'
              AND left(body->>'scope', length('search_alert.request_result:'))
                <> 'search_alert.request_result:'
              AND left(body->>'scope', length('search_alert.decision_intent:'))
                <> 'search_alert.decision_intent:'
            ORDER BY body->>'expiresAt', id
            FOR UPDATE SKIP LOCKED
            LIMIT ${input.limit}`;
          let removed = 0;
          for (const record of expired) {
            const rows = await tx<{ readonly id: string }[]>`
              DELETE FROM jobbbler.entity_records
              WHERE kind = 'idempotency'
                AND id = ${record.id}
                AND body->>'expiresAt' <= ${input.now}
                AND left(body->>'scope', length('search_alert.request_saga:'))
                  <> 'search_alert.request_saga:'
                AND left(body->>'scope', length('search_alert.request:'))
                  <> 'search_alert.request:'
                AND left(body->>'scope', length('search_alert.request_result:'))
                  <> 'search_alert.request_result:'
                AND left(body->>'scope', length('search_alert.decision_intent:'))
                  <> 'search_alert.decision_intent:'
              RETURNING id`;
            if (rows[0] !== undefined) removed += 1;
          }
          return removed;
        });
      },
    },
    ingestion: {
      async insertRun(record) {
        return insert(sql, "source_run", record);
      },
      async finishRun(record) {
        const current = await get<SourceRunRecord>(sql, "source_run", record.id);
        if (current === null) throw domain("NOT_FOUND", "Source run was not found.");
        return write(sql, "source_run", record);
      },
      async getRunById(id) {
        return get<SourceRunRecord>(sql, "source_run", id);
      },
      async putSourceState(input: SourceStateInput, expectedVersion: number | null) {
        const id = `${input.sourceKey}:${input.partition}`;
        const current = await get<SourceStateRecord & { readonly id: string }>(
          sql,
          "source_state",
          id,
        );
        if (
          (current === null && expectedVersion !== null) ||
          (current !== null && current.version !== expectedVersion)
        )
          throw domain("CONFLICT", "Source state changed after it was read. Refresh and retry.");
        const next = { ...input, id, version: current === null ? 0 : current.version + 1 };
        await write(sql, "source_state", next);
        const { id: _id, ...record } = next;
        return record;
      },
      async getSourceState(sourceKey, partition) {
        const current = await get<SourceStateRecord & { readonly id: string }>(
          sql,
          "source_state",
          `${sourceKey}:${partition}`,
        );
        if (current === null) return null;
        const { id: _id, ...record } = current;
        return record;
      },
      async listSourceStates() {
        const rows = await list<SourceStateRecord & { readonly id: string }>(sql, "source_state");
        return rows.map(({ id: _id, ...record }) => record);
      },
      async persistObservation(
        input: PersistSourceObservationInput,
      ): Promise<PersistSourceObservationResult> {
        return sql.begin(async (transaction) => {
          const tx = transaction as PostgresExecutor;
          const sourceRecordId = `source_${stableHash({ sourceKey: input.evidence.sourceKey, partition: input.evidence.partition, externalId: input.evidence.externalId, rawHash: input.evidence.rawHash })}`;
          const existing = await get<StoredSourceEvidence>(tx, "source_evidence", sourceRecordId);
          const evidence: StoredSourceEvidence = {
            ...input.evidence,
            id: sourceRecordId,
            firstFetchedAt: input.evidence.fetchedAt,
            payload: input.evidence.payload,
            normalization: input.normalization.accepted
              ? {
                  status: "accepted",
                  reason: null,
                  issues: [],
                  normalizerVersion: input.normalization.normalizerVersion,
                  normalizedHash: stableHash(input.normalization.job),
                  recordedAt: input.normalization.recordedAt,
                }
              : {
                  status: input.normalization.status,
                  reason: input.normalization.reason,
                  issues: input.normalization.issues,
                  normalizerVersion: input.normalization.normalizerVersion,
                  normalizedHash: null,
                  recordedAt: input.normalization.recordedAt,
                },
          };
          if (existing === null) await insert(tx, "source_evidence", evidence);
          await write(tx, "source_run_record", {
            id: `${input.runId}:${sourceRecordId}`,
            runId: input.runId,
            sourceRecordId,
            createdAt: input.evidence.fetchedAt,
          });
          if (!input.normalization.accepted)
            return {
              sourceRecordId,
              sourceRecordInserted: existing === null,
              normalizationInserted: existing === null,
              jobVersionInserted: false,
            };
          await write(tx, "organization", input.normalization.organization);
          await upsertJob(tx, input.normalization.job);
          const version: JobVersionRecord = {
            id: `job_version_${stableHash({ jobId: input.normalization.job.id, sourceRecordId, normalizedHash: stableHash(input.normalization.job) })}`,
            jobId: input.normalization.job.id,
            sourceRecordId,
            normalizedHash: stableHash(input.normalization.job),
            job: input.normalization.job,
            observedAt: input.normalization.recordedAt,
          };
          const prior = await get<JobVersionRecord>(tx, "job_version", version.id);
          if (prior === null) await insert(tx, "job_version", version);
          const link: JobSourceLinkRecord & { readonly id: string } = {
            id: `${input.normalization.job.id}:${input.evidence.sourceKey}:${input.evidence.partition}:${input.evidence.externalId}`,
            jobId: input.normalization.job.id,
            sourceKey: input.evidence.sourceKey,
            partition: input.evidence.partition,
            externalId: input.evidence.externalId,
            originalUrl: input.normalization.sourceLink.originalUrl,
            applyUrl: input.normalization.sourceLink.applyUrl,
            identityBasis: "source_id",
            firstSeenAt: input.evidence.fetchedAt,
            lastSeenAt: input.evidence.fetchedAt,
            status: "active",
            missingCompleteRuns: 0,
            lastCompleteRunId: null,
            latestSourceRecordId: sourceRecordId,
            latestSourceUpdatedAt: input.evidence.sourceUpdatedAt ?? input.evidence.fetchedAt,
            latestRawHash: input.evidence.rawHash,
            attributionLabel: input.evidence.attribution.label,
            attributionUrl: input.evidence.attribution.url,
            attributionRequired: input.evidence.attribution.required,
            followedLinkRequired: input.evidence.attribution.followedLinkRequired,
          };
          const oldLink = await get<typeof link>(tx, "job_source_link", link.id);
          await write(
            tx,
            "job_source_link",
            oldLink === null ? link : { ...oldLink, ...link, firstSeenAt: oldLink.firstSeenAt },
          );
          return {
            sourceRecordId,
            sourceRecordInserted: existing === null,
            normalizationInserted: existing === null,
            jobVersionInserted: prior === null,
          };
        });
      },
      async getEvidence(id) {
        return get<StoredSourceEvidence>(sql, "source_evidence", id);
      },
      async listJobVersions(jobId) {
        return (await list<JobVersionRecord>(sql, "job_version"))
          .filter((item) => item.jobId === jobId)
          .sort(
            (left, right) =>
              left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id),
          );
      },
      async listJobSourceLinks(jobId) {
        return (await list<JobSourceLinkRecord & { readonly id: string }>(sql, "job_source_link"))
          .filter((item) => item.jobId === jobId)
          .map(({ id: _id, ...item }) => item);
      },
      async reconcileCompletedRun(runId, closeAfterMisses): Promise<SourceReconciliationResult> {
        const run = await get<SourceRunRecord>(sql, "source_run", runId);
        if (run === null) throw domain("NOT_FOUND", "Source run was not found.");
        if (run.complete !== true)
          throw domain("CONFLICT", "Only complete source runs can reconcile disappearance.");
        const seen = new Set(
          (
            await list<{ readonly runId: string; readonly sourceRecordId: string }>(
              sql,
              "source_run_record",
            )
          )
            .filter((item) => item.runId === runId)
            .map((item) => item.sourceRecordId),
        );
        let possiblyClosed = 0;
        let closed = 0;
        for (const link of await list<JobSourceLinkRecord & { readonly id: string }>(
          sql,
          "job_source_link",
        )) {
          if (link.sourceKey !== run.sourceKey || link.partition !== run.partition) continue;
          if (seen.has(link.latestSourceRecordId)) continue;
          const missingCompleteRuns = link.missingCompleteRuns + 1;
          const status =
            missingCompleteRuns >= closeAfterMisses
              ? ("closed" as const)
              : ("possibly_closed" as const);
          if (status === "closed") closed += 1;
          else possiblyClosed += 1;
          await write(sql, "job_source_link", {
            ...link,
            missingCompleteRuns,
            status,
            lastCompleteRunId: runId,
          });
        }
        return { possiblyClosed, closed };
      },
      async purgeExpiredPayloads(now, limit) {
        const records = await list<StoredSourceEvidence>(sql, "source_evidence");
        let purged = 0;
        for (const record of records)
          if (purged < limit && record.retainedUntil <= now && record.payload !== null) {
            await write(sql, "source_evidence", { ...record, payload: null });
            purged += 1;
          }
        return purged;
      },
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
  return storage;
}
