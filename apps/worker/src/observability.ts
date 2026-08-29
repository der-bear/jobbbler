import { isDomainError } from "@jobbbler/core-domain";
import type { AuditEventRecord, Storage } from "@jobbbler/storage";

export type ObservableWorkerMode =
  "catalog_once" | "catalog_service" | "alert_once" | "alert_service" | "all_once" | "all_service";

interface WorkMetrics {
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly dead: number;
}

interface AlertMetrics {
  readonly evaluated: number;
  readonly queued: number;
  readonly delivered: number;
  readonly failed: number;
}

export interface RecordWorkerCycleInput {
  readonly audit: Pick<Storage["audit"], "append">;
  readonly id: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly durationMs: number;
  readonly mode: ObservableWorkerMode;
  readonly databaseDriver: "sqlite" | "postgres";
  readonly catalog: WorkMetrics | null;
  readonly alerts: AlertMetrics | null;
}

const MAX_COUNTER = 1_000_000_000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1_000;

export function safeWorkerLogError(error: unknown): {
  readonly errorKind: string;
  readonly errorCode?: string;
  readonly retryable?: boolean;
} {
  if (isDomainError(error)) {
    return {
      errorKind: "DomainError",
      errorCode: error.code,
      retryable: error.retryable,
    };
  }
  return { errorKind: error instanceof Error ? error.name : typeof error };
}

function boundedCounter(value: number, label: string, maximum = MAX_COUNTER): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`Worker ${label} must be a bounded non-negative integer.`);
  }
  return value;
}

function boundedIdentifier(value: string, label: string): string {
  if (
    value.length < 1 ||
    value.length > 160 ||
    /[\r\n]/u.test(value) ||
    value.includes(String.fromCharCode(0))
  ) {
    throw new TypeError(`Worker ${label} is invalid.`);
  }
  return value;
}

export async function recordWorkerCycle(input: RecordWorkerCycleInput): Promise<AuditEventRecord> {
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== input.occurredAt) {
    throw new TypeError("Worker heartbeat time must be a canonical ISO instant.");
  }

  const record: AuditEventRecord = {
    id: boundedIdentifier(input.id, "heartbeat ID"),
    type: "worker.cycle.completed",
    actorKind: "service",
    actorId: null,
    aggregateType: "system",
    aggregateId: "worker_cycle",
    correlationId: boundedIdentifier(input.correlationId, "correlation ID"),
    safeMetadata: {
      mode: input.mode,
      databaseDriver: input.databaseDriver,
      durationMs: boundedCounter(input.durationMs, "cycle duration", MAX_DURATION_MS),
      catalogClaimed: boundedCounter(input.catalog?.claimed ?? 0, "catalog claimed count"),
      catalogSucceeded: boundedCounter(input.catalog?.succeeded ?? 0, "catalog succeeded count"),
      catalogFailed: boundedCounter(input.catalog?.failed ?? 0, "catalog failed count"),
      catalogDead: boundedCounter(input.catalog?.dead ?? 0, "catalog dead count"),
      alertEvaluated: boundedCounter(input.alerts?.evaluated ?? 0, "alert evaluated count"),
      alertQueued: boundedCounter(input.alerts?.queued ?? 0, "alert queued count"),
      alertDelivered: boundedCounter(input.alerts?.delivered ?? 0, "alert delivered count"),
      alertFailed: boundedCounter(input.alerts?.failed ?? 0, "alert failed count"),
    },
    occurredAt: input.occurredAt,
  };

  return input.audit.append(record);
}
