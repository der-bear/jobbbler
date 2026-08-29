import { DomainError } from "@jobbbler/core-domain";
import type {
  AlertBaselineItem,
  AlertChangeRecord,
  AlertDeliveryPutResult,
  AlertDeliveryRecord,
  AlertDeliveryUpdate,
  AlertEvaluationRecord,
  AlertRepository,
} from "@jobbbler/storage";

import type { SqliteDatabase } from "./connection.js";

interface EvaluationRow {
  readonly id: string;
  readonly owner_id: string;
  readonly saved_search_id: string;
  readonly schedule_id: string;
  readonly catalog_updated_at: string | null;
  readonly created_at: string;
}

interface BaselineRow {
  readonly job_id: string;
  readonly fingerprint: string;
}

interface ChangeRow {
  readonly id: string;
  readonly evaluation_id: string;
  readonly job_id: string;
  readonly kind: AlertChangeRecord["kind"];
  readonly created_at: string;
}

interface DeliveryRow {
  readonly id: string;
  readonly evaluation_id: string;
  readonly owner_id: string;
  readonly schedule_id: string;
  readonly endpoint_id: string;
  readonly content_hash: string;
  readonly status: AlertDeliveryRecord["status"];
  readonly attempt: number;
  readonly provider_ref: string | null;
  readonly error_code: string | null;
  readonly accepted_at: string | null;
  readonly last_attempt_at: string | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

function evaluationFromRow(database: SqliteDatabase, row: EvaluationRow): AlertEvaluationRecord {
  const baseline = database
    .prepare(
      `SELECT job_id, fingerprint
       FROM alert_evaluation_baselines
       WHERE evaluation_id = ?
       ORDER BY job_id`,
    )
    .all(row.id) as BaselineRow[];
  return {
    id: row.id,
    ownerId: row.owner_id,
    savedSearchId: row.saved_search_id,
    scheduleId: row.schedule_id,
    catalogUpdatedAt: row.catalog_updated_at,
    createdAt: row.created_at,
    baseline: baseline.map((item): AlertBaselineItem => ({
      jobId: item.job_id,
      fingerprint: item.fingerprint,
    })),
  };
}

function changeFromRow(row: ChangeRow): AlertChangeRecord {
  return {
    id: row.id,
    evaluationId: row.evaluation_id,
    jobId: row.job_id,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

function deliveryFromRow(row: DeliveryRow): AlertDeliveryRecord {
  return {
    id: row.id,
    evaluationId: row.evaluation_id,
    ownerId: row.owner_id,
    scheduleId: row.schedule_id,
    endpointId: row.endpoint_id,
    contentHash: row.content_hash,
    status: row.status,
    attempt: row.attempt,
    providerRef: row.provider_ref,
    errorCode: row.error_code,
    acceptedAt: row.accepted_at,
    lastAttemptAt: row.last_attempt_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function conflict(message: string): DomainError {
  return new DomainError({ code: "CONFLICT", message });
}

function ensureUnique<T>(items: readonly T[], key: (item: T) => string, label: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    const id = key(item);
    if (ids.has(id)) throw new TypeError(`${label} values must be unique.`);
    ids.add(id);
  }
}

function sameDeliveryBinding(left: AlertDeliveryRecord, right: AlertDeliveryRecord): boolean {
  return (
    left.evaluationId === right.evaluationId &&
    left.ownerId === right.ownerId &&
    left.scheduleId === right.scheduleId &&
    left.endpointId === right.endpointId &&
    left.contentHash === right.contentHash
  );
}

function ensureDeliveryBinding(database: SqliteDatabase, record: AlertDeliveryRecord): void {
  const matching = database
    .prepare(
      `SELECT 1
       FROM alert_evaluations evaluations
       JOIN schedules ON schedules.id = evaluations.schedule_id
       WHERE evaluations.id = ?
         AND evaluations.owner_id = ?
         AND evaluations.schedule_id = ?
         AND schedules.owner_id = ?
         AND schedules.delivery_endpoint_id = ?`,
    )
    .get(record.evaluationId, record.ownerId, record.scheduleId, record.ownerId, record.endpointId);
  if (matching === undefined) {
    throw new DomainError({
      code: "VALIDATION",
      message: "Notification delivery must match its evaluation, owner, schedule, and endpoint.",
    });
  }
}

export function createSqliteAlertRepository(database: SqliteDatabase): AlertRepository {
  return {
    async getLatestEvaluation(savedSearchId) {
      const row = database
        .prepare(
          `SELECT * FROM alert_evaluations
           WHERE saved_search_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(savedSearchId) as EvaluationRow | undefined;
      return row === undefined ? null : evaluationFromRow(database, row);
    },

    async insertEvaluation(input) {
      ensureUnique(input.evaluation.baseline, (item) => item.jobId, "Alert baseline job");
      ensureUnique(input.changes, (item) => item.id, "Alert change ID");
      if (input.changes.some((change) => change.evaluationId !== input.evaluation.id)) {
        throw new TypeError("Alert changes must belong to the evaluation being inserted.");
      }
      const insert = database.transaction(() => {
        const schedule = database
          .prepare(
            `SELECT 1 FROM schedules
             WHERE id = ? AND owner_id = ? AND saved_search_id = ?`,
          )
          .get(
            input.evaluation.scheduleId,
            input.evaluation.ownerId,
            input.evaluation.savedSearchId,
          );
        if (schedule === undefined) {
          throw new DomainError({
            code: "VALIDATION",
            message: "Alert evaluation must match one owner-bound schedule and saved search.",
          });
        }
        database
          .prepare(
            `INSERT INTO alert_evaluations(
               id, owner_id, saved_search_id, schedule_id, catalog_updated_at, created_at
             ) VALUES (@id, @ownerId, @savedSearchId, @scheduleId, @catalogUpdatedAt, @createdAt)`,
          )
          .run(input.evaluation);
        const insertBaseline = database.prepare(
          `INSERT INTO alert_evaluation_baselines(evaluation_id, job_id, fingerprint)
           VALUES (?, ?, ?)`,
        );
        for (const baseline of input.evaluation.baseline) {
          insertBaseline.run(input.evaluation.id, baseline.jobId, baseline.fingerprint);
        }
        const insertChange = database.prepare(
          `INSERT INTO alert_changes(id, evaluation_id, job_id, kind, created_at)
           VALUES (@id, @evaluationId, @jobId, @kind, @createdAt)`,
        );
        for (const change of input.changes) insertChange.run(change);
        return input.evaluation;
      });
      return insert.immediate();
    },

    async listChanges(evaluationId) {
      const rows = database
        .prepare(
          `SELECT * FROM alert_changes
           WHERE evaluation_id = ?
           ORDER BY created_at, id`,
        )
        .all(evaluationId) as ChangeRow[];
      return rows.map(changeFromRow);
    },

    async putDeliveryIfAbsent(record): Promise<AlertDeliveryPutResult> {
      const put = database.transaction(() => {
        const byId = database
          .prepare("SELECT * FROM notification_deliveries WHERE id = ?")
          .get(record.id) as DeliveryRow | undefined;
        if (byId !== undefined) {
          const stored = deliveryFromRow(byId);
          if (!sameDeliveryBinding(stored, record)) {
            throw conflict("Notification delivery ID is already bound to different content.");
          }
          return { inserted: false, record: stored };
        }
        const byContent = database
          .prepare(
            `SELECT * FROM notification_deliveries
             WHERE schedule_id = ? AND evaluation_id = ? AND endpoint_id = ? AND content_hash = ?`,
          )
          .get(record.scheduleId, record.evaluationId, record.endpointId, record.contentHash) as
          DeliveryRow | undefined;
        if (byContent !== undefined) return { inserted: false, record: deliveryFromRow(byContent) };
        ensureDeliveryBinding(database, record);
        database
          .prepare(
            `INSERT INTO notification_deliveries(
               id, evaluation_id, owner_id, schedule_id, endpoint_id, content_hash, status, attempt,
               provider_ref, error_code, accepted_at, last_attempt_at, version, created_at, updated_at
             ) VALUES (
               @id, @evaluationId, @ownerId, @scheduleId, @endpointId, @contentHash, @status, @attempt,
               @providerRef, @errorCode, @acceptedAt, @lastAttemptAt, @version, @createdAt, @updatedAt
             )`,
          )
          .run(record);
        return { inserted: true, record };
      });
      return put.immediate();
    },

    async getDelivery(id) {
      const row = database.prepare("SELECT * FROM notification_deliveries WHERE id = ?").get(id) as
        DeliveryRow | undefined;
      return row === undefined ? null : deliveryFromRow(row);
    },

    async getLatestDelivery(scheduleId) {
      const row = database
        .prepare(
          `SELECT * FROM notification_deliveries
           WHERE schedule_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(scheduleId) as DeliveryRow | undefined;
      return row === undefined ? null : deliveryFromRow(row);
    },

    async updateDelivery(input: AlertDeliveryUpdate, expectedVersion: number) {
      const result = database
        .prepare(
          `UPDATE notification_deliveries
           SET status = @status,
               attempt = @attempt,
               provider_ref = @providerRef,
               error_code = @errorCode,
               accepted_at = @acceptedAt,
               last_attempt_at = @lastAttemptAt,
               version = version + 1,
               updated_at = @updatedAt
           WHERE id = @id AND version = @expectedVersion`,
        )
        .run({ ...input, expectedVersion });
      if (result.changes === 0) {
        const existing = database
          .prepare("SELECT 1 FROM notification_deliveries WHERE id = ?")
          .get(input.id);
        throw existing === undefined
          ? new DomainError({ code: "NOT_FOUND", message: "Notification delivery was not found." })
          : conflict("Notification delivery changed after it was read. Refresh and retry.");
      }
      const row = database
        .prepare("SELECT * FROM notification_deliveries WHERE id = ?")
        .get(input.id) as DeliveryRow | undefined;
      if (row === undefined) {
        throw new DomainError({
          code: "NOT_FOUND",
          message: "Notification delivery was not found.",
        });
      }
      return deliveryFromRow(row);
    },
  };
}
