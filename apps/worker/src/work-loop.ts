import { isDomainError } from "@jobbbler/core-domain";
import type { Storage, WorkItemRecord } from "@jobbbler/storage";

export interface RunWorkBatchInput {
  readonly storage: Storage;
  readonly workerId: string;
  readonly now: string;
  readonly leaseSeconds: number;
  readonly limit: number;
  readonly signal: AbortSignal;
  readonly random?: () => number;
  readonly handle: (item: WorkItemRecord, signal: AbortSignal) => Promise<void>;
}

export interface WorkBatchResult {
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly dead: number;
}

function instant(value: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error("Work-loop time must be an ISO instant.");
  return timestamp;
}

function addSeconds(now: string, seconds: number): string {
  return new Date(instant(now) + seconds * 1_000).toISOString();
}

function advancingClock(start: string): () => string {
  const startTimestamp = instant(start);
  const startedAt = Date.now();
  return () => new Date(startTimestamp + Math.max(0, Date.now() - startedAt)).toISOString();
}

function retryAt(now: string, attempt: number, error: unknown, random: () => number): string {
  if (isDomainError(error)) {
    const requested = error.details?.["retryAt"];
    if (
      typeof requested === "string" &&
      !Number.isNaN(Date.parse(requested)) &&
      Date.parse(requested) > instant(now)
    ) {
      return new Date(Date.parse(requested)).toISOString();
    }
  }
  const baseSeconds = Math.min(3_600, 30 * 2 ** Math.max(0, attempt - 1));
  const boundedRandom = Math.min(1, Math.max(0, random()));
  const delaySeconds = Math.round(baseSeconds * (0.8 + boundedRandom * 0.4));
  return new Date(instant(now) + delaySeconds * 1_000).toISOString();
}

export async function runWorkBatch(input: RunWorkBatchInput): Promise<WorkBatchResult> {
  if (
    !Number.isSafeInteger(input.leaseSeconds) ||
    input.leaseSeconds < 1 ||
    input.leaseSeconds > 3_600
  ) {
    throw new Error("Work-item lease must be between 1 and 3600 seconds.");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error("Work batch limit must be between 1 and 100.");
  }
  const now = advancingClock(input.now);
  const leaseExpiresAt = addSeconds(input.now, input.leaseSeconds);
  const claimed = await input.storage.workItems.claimDue({
    workerId: input.workerId,
    now: input.now,
    leaseExpiresAt,
    limit: input.limit,
  });
  let succeeded = 0;
  let failed = 0;
  let dead = 0;
  const random = input.random ?? Math.random;
  const renewalIntervalMs = Math.max(250, Math.floor((input.leaseSeconds * 1_000) / 2));

  await Promise.all(
    claimed.map(async (item) => {
      let renewalError: unknown = null;
      let renewed = false;
      let renewals = Promise.resolve();
      const operationNow = () => (renewed || renewalError !== null ? now() : input.now);
      const renewLease = () => {
        renewals = renewals.then(async () => {
          if (renewalError !== null) return;
          const renewedAt = now();
          try {
            await input.storage.workItems.renewLease({
              id: item.id,
              workerId: input.workerId,
              now: renewedAt,
              leaseExpiresAt: addSeconds(renewedAt, input.leaseSeconds),
            });
            renewed = true;
          } catch (error) {
            renewalError = error;
          }
        });
      };
      const renewalTimer = setInterval(renewLease, renewalIntervalMs);
      try {
        if (input.signal.aborted) throw input.signal.reason;
        await input.handle(item, input.signal);
        await renewals;
        if (renewalError !== null) throw renewalError;
        await input.storage.workItems.complete(item.id, input.workerId, operationNow());
        succeeded += 1;
      } catch (error) {
        await renewals;
        const retryable = !isDomainError(error) || error.retryable;
        const failedAt = operationNow();
        const stored = await input.storage.workItems.fail({
          id: item.id,
          workerId: input.workerId,
          now: failedAt,
          retryAt: retryAt(failedAt, item.attempt, error, random),
          errorCode: isDomainError(error) ? error.code : "INTERNAL",
          terminal: !retryable,
        });
        if (stored.status === "dead") dead += 1;
        else failed += 1;
      } finally {
        clearInterval(renewalTimer);
      }
    }),
  );

  return { claimed: claimed.length, succeeded, failed, dead };
}
