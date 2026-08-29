import { apiErrorCodeSchema, type ApiErrorCode } from "@jobbbler/contracts";
import {
  sourceKeySchema,
  sourcePurposeSchema,
  type JobConnector,
  type SourcePurpose,
} from "@jobbbler/connectors";
import { DomainError } from "@jobbbler/core-domain";
import type { SourceRunRecord, Storage } from "@jobbbler/storage";

import { runConnectorIngestion, type IngestionEvent } from "./ingest.js";
import { runWorkBatch, type WorkBatchResult } from "./work-loop.js";

export interface RunLeasedConnectorBatchInput {
  readonly connectors: readonly JobConnector[];
  readonly storage: Storage;
  readonly now: string;
  readonly workerId: string;
  readonly workIdFor: (sourceKey: string) => string;
  readonly runIdFor: (sourceKey: string, attempt: number, workItemId: string) => string;
  readonly purposeFor: (sourceKey: string) => SourcePurpose;
  readonly limit: number;
  readonly signal: AbortSignal;
  readonly random?: () => number;
  readonly onEvent?: (event: IngestionEvent) => void | Promise<void>;
}

export interface LeasedConnectorBatchResult {
  readonly work: WorkBatchResult;
  readonly runs: readonly SourceRunRecord[];
  readonly purgedPayloads: number;
}

function retryable(code: ApiErrorCode): boolean {
  return ["CANCELLED", "DEPENDENCY", "INTERNAL", "RATE_LIMITED"].includes(code);
}

export async function runLeasedConnectorBatch(
  input: RunLeasedConnectorBatchInput,
): Promise<LeasedConnectorBatchResult> {
  const connectors = new Map(
    input.connectors.map((connector) => [connector.descriptor.key, connector]),
  );
  for (const connector of input.connectors) {
    const sourceKey = connector.descriptor.key;
    await input.storage.workItems.putIfAbsent({
      id: input.workIdFor(sourceKey),
      kind: "catalog_ingest",
      payload: { sourceKey, purpose: input.purposeFor(sourceKey), limit: input.limit },
      status: "pending",
      availableAt: input.now,
      attempt: 0,
      maxAttempts: 3,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  const runs = new Map<string, SourceRunRecord>();
  const work = await runWorkBatch({
    storage: input.storage,
    workerId: input.workerId,
    now: input.now,
    leaseSeconds: 120,
    limit: Math.max(1, Math.min(100, input.connectors.length)),
    signal: input.signal,
    ...(input.random === undefined ? {} : { random: input.random }),
    handle: async (item, signal) => {
      if (item.kind !== "catalog_ingest") {
        throw new DomainError({
          code: "VALIDATION",
          message: "Catalog worker received an unsupported work-item kind.",
        });
      }
      const sourceKey = sourceKeySchema.parse(item.payload["sourceKey"]);
      const purpose = sourcePurposeSchema.parse(item.payload["purpose"]);
      const limit = Number(item.payload["limit"]);
      const connector = connectors.get(sourceKey);
      if (connector === undefined) {
        throw new DomainError({
          code: "VALIDATION",
          message: "Catalog work references an unavailable connector.",
        });
      }
      const run = await runConnectorIngestion({
        connector,
        storage: input.storage,
        purpose,
        now: input.now,
        limit,
        runId: input.runIdFor(sourceKey, item.attempt, item.id),
        signal,
        ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
      });
      runs.set(sourceKey, run);
      if (run.status === "failed" || run.errorCode === "RATE_LIMITED") {
        const code = apiErrorCodeSchema.parse(run.errorCode ?? "INTERNAL");
        const state = await input.storage.ingestion.getSourceState(sourceKey, run.partition);
        throw new DomainError({
          code,
          message: `Catalog ingestion for ${sourceKey} did not complete.`,
          retryable: retryable(code),
          ...(state === null ? {} : { details: { retryAt: state.nextAllowedAt } }),
        });
      }
    },
  });
  const purgedPayloads = await input.storage.ingestion.purgeExpiredPayloads(input.now, 1_000);
  return {
    work,
    runs: input.connectors
      .map((connector) => runs.get(connector.descriptor.key))
      .filter((run): run is SourceRunRecord => run !== undefined),
    purgedPayloads,
  };
}
