import { type ApiErrorCode } from "@jobbbler/contracts";
import {
  assertSourceFetchAllowed,
  getNextAllowedAt,
  type JobConnector,
  type RawSourceRecord,
  type SourcePurpose,
} from "@jobbbler/connectors";
import { isDomainError } from "@jobbbler/core-domain";
import type {
  PersistSourceObservationInput,
  SourceRunRecord,
  SourceStateInput,
  SourceStateRecord,
  Storage,
} from "@jobbbler/storage";

const NORMALIZER_VERSION = 1;

export type IngestionEventType =
  | "run_started"
  | "record_accepted"
  | "record_rejected"
  | "run_completed"
  | "run_failed"
  | "policy_blocked";

export interface IngestionEvent {
  readonly type: IngestionEventType;
  readonly runId: string;
  readonly sourceKey: string;
  readonly partition: string;
  readonly occurredAt: string;
  readonly safeDetails: Readonly<Record<string, string | number | boolean | null>>;
}

export interface RunConnectorIngestionInput {
  readonly connector: JobConnector;
  readonly storage: Storage;
  readonly purpose: SourcePurpose;
  readonly now: string;
  readonly limit: number;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly onEvent?: (event: IngestionEvent) => void | Promise<void>;
}

export interface RunConnectorBatchInput {
  readonly connectors: readonly JobConnector[];
  readonly storage: Storage;
  readonly purpose: SourcePurpose;
  readonly now: string;
  readonly limit: number;
  readonly signal: AbortSignal;
  readonly runIdFor: (sourceKey: string) => string;
  readonly onEvent?: (event: IngestionEvent) => void | Promise<void>;
}

interface RunCounters {
  pagesFetched: number;
  recordsFetched: number;
  recordsAccepted: number;
  recordsRejected: number;
  recordsUnchanged: number;
}

function initialRun(input: RunConnectorIngestionInput, partition: string): SourceRunRecord {
  return {
    id: input.runId,
    sourceKey: input.connector.descriptor.key,
    partition,
    purpose: input.purpose === "evaluation" ? "evaluation" : "production",
    status: "running",
    policyVersion: input.connector.policy.version,
    startedAt: input.now,
    completedAt: null,
    complete: null,
    notModified: false,
    pagesFetched: 0,
    recordsFetched: 0,
    recordsAccepted: 0,
    recordsRejected: 0,
    recordsUnchanged: 0,
    responseEtag: null,
    responseLastModified: null,
    responseBytes: 0,
    errorCode: null,
  };
}

function errorCode(error: unknown): ApiErrorCode {
  return isDomainError(error) ? error.code : "INTERNAL";
}

function stateInput(
  input: RunConnectorIngestionInput,
  current: SourceStateRecord | null,
  health: SourceStateInput["health"],
  options: {
    readonly attempted: boolean;
    readonly successful: boolean;
    readonly failed?: boolean;
    readonly etag?: string | null;
    readonly lastModified?: string | null;
  },
): SourceStateInput {
  return {
    sourceKey: input.connector.descriptor.key,
    partition: input.connector.descriptor.partitions[0] ?? "default",
    health,
    lastAttemptAt: options.attempted ? input.now : (current?.lastAttemptAt ?? null),
    lastSuccessfulAt: options.successful ? input.now : (current?.lastSuccessfulAt ?? null),
    nextAllowedAt: options.attempted
      ? getNextAllowedAt(input.connector.policy, input.now)
      : (current?.nextAllowedAt ?? input.now),
    consecutiveFailures: options.successful
      ? 0
      : options.failed === true
        ? (current?.consecutiveFailures ?? 0) + 1
        : (current?.consecutiveFailures ?? 0),
    etag: options.etag === undefined ? (current?.etag ?? null) : options.etag,
    lastModified:
      options.lastModified === undefined ? (current?.lastModified ?? null) : options.lastModified,
    policyVersion: input.connector.policy.version,
    updatedAt: input.now,
  };
}

async function emit(
  input: RunConnectorIngestionInput,
  partition: string,
  type: IngestionEventType,
  safeDetails: IngestionEvent["safeDetails"] = {},
): Promise<void> {
  try {
    await input.onEvent?.({
      type,
      runId: input.runId,
      sourceKey: input.connector.descriptor.key,
      partition,
      occurredAt: input.now,
      safeDetails,
    });
  } catch {
    // Activity delivery is deliberately best-effort: source truth must remain authoritative.
  }
}

function observation(
  runId: string,
  connector: JobConnector,
  record: RawSourceRecord,
): PersistSourceObservationInput {
  const result = connector.normalize(record);
  const evidence = {
    sourceKey: record.sourceKey,
    partition: record.partition,
    externalId: record.externalId,
    originalUrl: record.originalUrl,
    applyUrl: record.applyUrl,
    sourceUpdatedAt: record.sourceUpdatedAt,
    fetchedAt: record.fetchedAt,
    retainedUntil: record.retainUntil,
    rawHash: record.rawHash,
    payload: record.payload,
    policyVersion: record.policyVersion,
    attribution: record.attribution,
  };
  return result.accepted
    ? {
        runId,
        evidence,
        normalization: {
          accepted: true,
          normalizerVersion: NORMALIZER_VERSION,
          recordedAt: record.fetchedAt,
          organization: result.organization,
          job: result.job,
          sourceLink: {
            originalUrl: result.sourceLink.originalUrl,
            applyUrl: result.sourceLink.applyUrl,
            identityBasis: result.sourceLink.identityBasis,
          },
        },
      }
    : {
        runId,
        evidence,
        normalization: {
          accepted: false,
          status: "rejected",
          reason: result.reason,
          issues: result.validationIssues,
          normalizerVersion: NORMALIZER_VERSION,
          recordedAt: record.fetchedAt,
        },
      };
}

async function finishPolicyBlocked(
  input: RunConnectorIngestionInput,
  run: SourceRunRecord,
  partition: string,
  currentState: SourceStateRecord | null,
  error: unknown,
): Promise<SourceRunRecord> {
  const code = errorCode(error);
  const state = stateInput(
    input,
    currentState,
    input.connector.policy.enabled ? (currentState?.health ?? "healthy") : "disabled",
    { attempted: false, successful: false },
  );
  await input.storage.ingestion.putSourceState(state, currentState?.version ?? null);
  const finished = await input.storage.ingestion.finishRun({
    ...run,
    status: "skipped",
    completedAt: input.now,
    complete: false,
    errorCode: code,
  });
  await emit(input, partition, "policy_blocked", { code });
  return finished;
}

export async function runConnectorIngestion(
  input: RunConnectorIngestionInput,
): Promise<SourceRunRecord> {
  const partition = input.connector.descriptor.partitions[0] ?? "default";
  const run = initialRun(input, partition);
  const counters: RunCounters = {
    pagesFetched: 0,
    recordsFetched: 0,
    recordsAccepted: 0,
    recordsRejected: 0,
    recordsUnchanged: 0,
  };
  const currentState = await input.storage.ingestion.getSourceState(
    input.connector.descriptor.key,
    partition,
  );
  await input.storage.ingestion.insertRun(run);
  await emit(input, partition, "run_started", { purpose: input.purpose });

  try {
    assertSourceFetchAllowed(
      input.connector.policy,
      input.purpose,
      input.now,
      currentState?.lastAttemptAt ?? null,
    );
  } catch (error) {
    return finishPolicyBlocked(input, run, partition, currentState, error);
  }

  let claimedState: SourceStateRecord;
  try {
    claimedState = await input.storage.ingestion.putSourceState(
      stateInput(input, currentState, currentState?.health ?? "healthy", {
        attempted: true,
        successful: false,
      }),
      currentState?.version ?? null,
    );
  } catch (error) {
    const code = errorCode(error);
    const skipped = await input.storage.ingestion.finishRun({
      ...run,
      status: "skipped",
      completedAt: input.now,
      complete: false,
      errorCode: code,
    });
    await emit(input, partition, "run_failed", { code, sourceClaimed: false });
    return skipped;
  }
  let etag = currentState?.etag ?? null;
  let lastModified = currentState?.lastModified ?? null;
  let responseBytes = 0;
  let page = 1;
  let complete = false;
  let notModified = false;

  try {
    while (counters.recordsFetched < input.limit) {
      const fetchedPage = page;
      const iterator = input.connector.fetchPartition(
        {
          partition,
          page,
          limit: Math.max(0, input.limit - counters.recordsFetched),
          fetchedAt: input.now,
          etag: page === 1 ? etag : null,
          lastModified: page === 1 ? lastModified : null,
        },
        input.signal,
      );
      while (true) {
        const next = await iterator.next();
        if (next.done) {
          counters.pagesFetched += 1;
          responseBytes += next.value.bytes;
          notModified ||= next.value.notModified;
          if (fetchedPage === 1) {
            etag = next.value.etag ?? etag;
            lastModified = next.value.lastModified ?? lastModified;
          }
          complete = next.value.complete && next.value.nextPage === null;
          if (next.value.nextPage === null || counters.recordsFetched >= input.limit) {
            page = 0;
          } else {
            page = next.value.nextPage;
          }
          break;
        }

        const normalized = observation(input.runId, input.connector, next.value);
        const persisted = await input.storage.ingestion.persistObservation(normalized);
        counters.recordsFetched += 1;
        if (!persisted.sourceRecordInserted) counters.recordsUnchanged += 1;
        if (normalized.normalization.accepted) {
          counters.recordsAccepted += 1;
          await emit(input, partition, "record_accepted", {
            externalId: normalized.evidence.externalId,
            changed: persisted.jobVersionInserted,
          });
        } else {
          counters.recordsRejected += 1;
          await emit(input, partition, "record_rejected", {
            externalId: normalized.evidence.externalId,
            reason: normalized.normalization.reason,
          });
        }
      }
      if (page === 0) break;
    }

    claimedState = await input.storage.ingestion.putSourceState(
      stateInput(input, claimedState, "healthy", {
        attempted: true,
        successful: true,
        etag,
        lastModified,
      }),
      claimedState.version,
    );
    const finished = await input.storage.ingestion.finishRun({
      ...run,
      ...counters,
      status: complete ? "succeeded" : "partial",
      completedAt: input.now,
      complete,
      notModified,
      responseEtag: etag,
      responseLastModified: lastModified,
      responseBytes,
      errorCode: null,
    });
    const reconciliation = finished.notModified
      ? { possiblyClosed: 0, closed: 0 }
      : await input.storage.ingestion.reconcileCompletedRun(finished.id, 2);
    await emit(input, partition, "run_completed", {
      status: finished.status,
      recordsFetched: finished.recordsFetched,
      recordsAccepted: finished.recordsAccepted,
      recordsRejected: finished.recordsRejected,
      possiblyClosed: reconciliation.possiblyClosed,
      closed: reconciliation.closed,
    });
    return finished;
  } catch (error) {
    const code = errorCode(error);
    const persistedRun = await input.storage.ingestion.getRunById(run.id);
    if (persistedRun !== null && persistedRun.status !== "running") {
      await emit(input, partition, "run_failed", { code, postProcessing: true });
      return persistedRun;
    }
    await input.storage.ingestion.putSourceState(
      stateInput(input, claimedState, "degraded", {
        attempted: true,
        successful: false,
        failed: true,
        etag,
        lastModified,
      }),
      claimedState.version,
    );
    const failed = await input.storage.ingestion.finishRun({
      ...run,
      ...counters,
      status: "failed",
      completedAt: input.now,
      complete: false,
      notModified,
      responseEtag: etag,
      responseLastModified: lastModified,
      responseBytes,
      errorCode: code,
    });
    await emit(input, partition, "run_failed", { code });
    return failed;
  }
}

export async function runConnectorBatch(input: RunConnectorBatchInput): Promise<SourceRunRecord[]> {
  const results: SourceRunRecord[] = [];
  for (const connector of input.connectors) {
    results.push(
      await runConnectorIngestion({
        connector,
        storage: input.storage,
        purpose: input.purpose,
        now: input.now,
        limit: input.limit,
        runId: input.runIdFor(connector.descriptor.key),
        signal: input.signal,
        ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
      }),
    );
  }
  return results;
}
