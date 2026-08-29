import { createHash } from "node:crypto";

import {
  DomainError,
  calculateNextRun,
  calculateSearchDeltas,
  classifyNotificationRetry,
  createNotificationDeliveryIdentity,
  deriveEvaluationJitterSeconds,
  createEntityId,
  isDomainError,
} from "@jobbbler/core-domain";
import type { JobSearchCriteria } from "@jobbbler/contracts";
import type {
  AlertChangeRecord,
  AlertDeliveryRecord,
  AlertDeliveryUpdate,
  AlertEvaluationRecord,
  Job,
  ScheduleRecord,
  Storage,
  WorkItemRecord,
} from "@jobbbler/storage";

import { runWorkBatch, type WorkBatchResult } from "./work-loop.js";

type AlertSchedulerStorage = {
  readonly schedules: Pick<Storage["schedules"], "listDue" | "update">;
  readonly savedSearches: Pick<Storage["savedSearches"], "getById">;
  readonly jobs: Pick<Storage["jobs"], "getById" | "search">;
  readonly identity: Pick<Storage["identity"], "getVerificationEndpoint">;
  readonly alerts: Pick<
    Storage["alerts"],
    "getLatestEvaluation" | "insertEvaluation" | "putDeliveryIfAbsent"
  >;
  readonly workItems: Pick<Storage["workItems"], "putIfAbsent">;
  readonly ownerActivity?: Pick<Storage["ownerActivity"], "append">;
};

type AlertDeliveryStorage = {
  readonly alerts: Pick<Storage["alerts"], "getDelivery" | "listChanges" | "updateDelivery">;
  readonly identity: Pick<Storage["identity"], "getVerificationEndpoint">;
};

export interface RunAlertSchedulerInput {
  readonly storage: AlertSchedulerStorage;
  readonly now: string;
  readonly limit: number;
}

export interface AlertSchedulerResult {
  readonly due: number;
  readonly evaluated: number;
  readonly queued: number;
  readonly suppressed: number;
  readonly disabled: number;
}

export interface AlertDeliverySender {
  send(input: {
    readonly deliveryId: string;
    readonly endpointId: string;
    readonly encryptedAddress: string;
    readonly contentHash: string;
    readonly subject: string;
    readonly text: string;
  }): Promise<{ readonly providerRef: string | null }>;
}

export interface HandleAlertDeliveryInput {
  readonly storage: AlertDeliveryStorage;
  readonly deliveryId: string;
  readonly now: string;
  readonly maxAttempts: number;
  readonly sender: AlertDeliverySender;
}

export interface RunAlertDeliveryBatchInput {
  readonly storage: Storage;
  readonly now: string;
  readonly workerId: string;
  readonly limit: number;
  readonly signal: AbortSignal;
  readonly sender: AlertDeliverySender;
  readonly random?: () => number;
}

export type AlertDeliveryResult =
  | { readonly status: "accepted"; readonly deliveryId: string }
  | { readonly status: "cancelled" | "dead" | "already_final"; readonly deliveryId: string };

const EVALUATION_JITTER_MAX_SECONDS = 120;
const MAX_SEARCH_PAGES = 20;

async function publishScheduleActivity(
  storage: AlertSchedulerStorage,
  input: Readonly<{
    ownerId: string;
    version: number;
    safeSummary: string;
    occurredAt: string;
    status?: "completed" | "failed";
  }>,
): Promise<void> {
  if (storage.ownerActivity === undefined) return;
  try {
    await storage.ownerActivity.append({
      ownerId: input.ownerId,
      event: {
        id: createEntityId("activity"),
        schemaVersion: 1,
        kind: "schedule",
        key: "evaluate_job_alert",
        status: input.status ?? "completed",
        safeSummary: input.safeSummary,
        correlationId: createEntityId("req"),
        actorKind: "service",
        aggregate: { type: "schedule", version: input.version },
        occurredAt: input.occurredAt,
        effects: [
          { target: "saved_searches", kind: "refresh" },
          { target: "agent_activity", kind: "announce" },
        ],
      },
    });
  } catch {
    // The durable alert state remains authoritative when its presentation-only projection fails.
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, values: readonly string[]): string {
  return `${prefix}_${hash(values.join("\u0000"))}`;
}

function addSeconds(instant: string, seconds: number): string {
  return new Date(Date.parse(instant) + seconds * 1_000).toISOString();
}

function nextRun(schedule: ScheduleRecord, now: string): string {
  return addSeconds(
    calculateNextRun(schedule.recurrence, now),
    deriveEvaluationJitterSeconds(schedule.savedSearchId, EVALUATION_JITTER_MAX_SECONDS),
  );
}

function jobFingerprint(job: Job): string {
  return hash(
    JSON.stringify({
      id: job.id,
      organizationId: job.organizationId,
      organizationName: job.organizationName,
      title: job.title,
      summary: job.summary,
      categories: job.categories,
      workModel: job.workModel,
      employmentType: job.employmentType,
      seniority: job.seniority,
      locations: job.locations,
      skills: job.skills,
      salary: job.salary,
      applyMode: job.applyMode,
      publishedAt: job.publishedAt,
      updatedAt: job.updatedAt,
    }),
  );
}

async function matchingJobs(
  storage: AlertSchedulerStorage,
  criteria: JobSearchCriteria,
  now: string,
): Promise<{ readonly jobs: readonly Job[]; readonly catalogUpdatedAt: string | null }> {
  const jobs = new Map<string, Job>();
  let cursor: string | null = null;
  let catalogUpdatedAt: string | null = null;
  for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
    const result = await storage.jobs.search({
      criteria: { ...criteria, cursor },
      now,
      limit: 50,
    });
    for (const job of result.jobs) {
      if (jobs.has(job.id))
        throw new DomainError({ code: "CONFLICT", message: "Search repeated a job." });
      jobs.set(job.id, job);
    }
    if (
      result.catalogUpdatedAt !== null &&
      (catalogUpdatedAt === null || result.catalogUpdatedAt > catalogUpdatedAt)
    ) {
      catalogUpdatedAt = result.catalogUpdatedAt;
    }
    if (result.nextCursor === null) return { jobs: [...jobs.values()], catalogUpdatedAt };
    cursor = result.nextCursor;
  }
  throw new DomainError({
    code: "DEPENDENCY",
    message: "Search evaluation exceeded its bounded page limit.",
    retryable: true,
  });
}

async function evaluateSchedule(
  storage: AlertSchedulerStorage,
  schedule: ScheduleRecord,
  now: string,
): Promise<{ readonly queued: boolean; readonly suppressed: boolean; readonly disabled: boolean }> {
  const endpoint = await storage.identity.getVerificationEndpoint(
    schedule.ownerId,
    schedule.deliveryEndpointId,
  );
  if (endpoint === null || endpoint.status !== "verified") {
    const disabled = await storage.schedules.update(
      { ...schedule, enabled: false, updatedAt: now },
      schedule.version,
    );
    await publishScheduleActivity(storage, {
      ownerId: schedule.ownerId,
      version: disabled.version,
      safeSummary: "Job alert paused because delivery verification is unavailable.",
      occurredAt: now,
      status: "failed",
    });
    return { queued: false, suppressed: false, disabled: true };
  }
  const savedSearch = await storage.savedSearches.getById(schedule.savedSearchId);
  if (savedSearch === null || savedSearch.ownerId !== schedule.ownerId) {
    throw new DomainError({
      code: "CONFLICT",
      message: "Alert schedule lost its saved search ownership.",
    });
  }

  const previous = await storage.alerts.getLatestEvaluation(schedule.savedSearchId);
  const baseline = previous?.scheduleId === schedule.id ? previous.baseline : null;
  const current = await matchingJobs(storage, savedSearch.criteria, now);
  const currentById = new Map(current.jobs.map((job) => [job.id, job]));
  const currentItems: Array<{
    readonly jobId: string;
    readonly fingerprint: string;
    readonly state: "matching" | "closed" | "no_longer_matching";
  }> = current.jobs.map((job) => ({
    jobId: job.id,
    fingerprint: jobFingerprint(job),
    state: "matching" as const,
  }));
  if (baseline !== null) {
    for (const prior of baseline) {
      if (currentById.has(prior.jobId)) continue;
      const job = await storage.jobs.getById(prior.jobId);
      currentItems.push({
        jobId: prior.jobId,
        fingerprint: prior.fingerprint,
        state: job?.status === "closed" ? "closed" : "no_longer_matching",
      });
    }
  }

  const deltas = calculateSearchDeltas({ previous: baseline, current: currentItems });
  const evaluationId = stableId("evaluation", [schedule.id, schedule.nextRunAt]);
  const evaluation: AlertEvaluationRecord = {
    id: evaluationId,
    ownerId: schedule.ownerId,
    savedSearchId: schedule.savedSearchId,
    scheduleId: schedule.id,
    catalogUpdatedAt: current.catalogUpdatedAt,
    createdAt: now,
    baseline: currentItems
      .filter((item) => item.state === "matching")
      .map(({ jobId, fingerprint }) => ({ jobId, fingerprint }))
      .sort((left, right) => left.jobId.localeCompare(right.jobId)),
  };
  const changes: AlertChangeRecord[] = deltas.deltas.map((delta) => ({
    id: stableId("change", [evaluationId, delta.jobId, delta.kind]),
    evaluationId,
    jobId: delta.jobId,
    kind: delta.kind,
    createdAt: now,
  }));

  try {
    await storage.alerts.insertEvaluation({ evaluation, changes });
  } catch (error) {
    if (!isDomainError(error) || error.code !== "CONFLICT") throw error;
    const latest = await storage.alerts.getLatestEvaluation(schedule.savedSearchId);
    if (latest?.id !== evaluationId) throw error;
  }

  const advanced = await storage.schedules.update(
    { ...schedule, nextRunAt: nextRun(schedule, now), updatedAt: now },
    schedule.version,
  );
  if (!deltas.shouldNotify) {
    await publishScheduleActivity(storage, {
      ownerId: schedule.ownerId,
      version: advanced.version,
      safeSummary: "Alert check completed with no material changes.",
      occurredAt: now,
    });
    return { queued: false, suppressed: true, disabled: false };
  }

  const contentHash = hash(JSON.stringify(changes.map(({ jobId, kind }) => ({ jobId, kind }))));
  const deliveryId = await createNotificationDeliveryIdentity({
    scheduleId: schedule.id,
    searchRunId: evaluationId,
    endpointId: endpoint.id,
    digestContentHash: contentHash,
    variant: "standard",
  });
  const delivery: AlertDeliveryRecord = {
    id: deliveryId,
    evaluationId,
    ownerId: schedule.ownerId,
    scheduleId: schedule.id,
    endpointId: endpoint.id,
    contentHash,
    status: "pending",
    attempt: 0,
    providerRef: null,
    errorCode: null,
    acceptedAt: null,
    lastAttemptAt: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
  const put = await storage.alerts.putDeliveryIfAbsent(delivery);
  if (put.inserted) {
    const work: WorkItemRecord = {
      id: `work_alert_${deliveryId}`,
      kind: "alert_delivery",
      payload: { deliveryId },
      status: "pending",
      availableAt: now,
      attempt: 0,
      maxAttempts: 5,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    await storage.workItems.putIfAbsent(work);
  }
  await publishScheduleActivity(storage, {
    ownerId: schedule.ownerId,
    version: advanced.version,
    safeSummary: "Alert check found material job changes.",
    occurredAt: now,
  });
  return { queued: put.inserted, suppressed: false, disabled: false };
}

export async function runAlertScheduler(
  input: RunAlertSchedulerInput,
): Promise<AlertSchedulerResult> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new TypeError("Alert scheduler limit must be between 1 and 100.");
  }
  const schedules = await input.storage.schedules.listDue(input.now, input.limit);
  let evaluated = 0;
  let queued = 0;
  let suppressed = 0;
  let disabled = 0;
  for (const schedule of schedules) {
    const outcome = await evaluateSchedule(input.storage, schedule, input.now);
    evaluated += outcome.disabled ? 0 : 1;
    queued += outcome.queued ? 1 : 0;
    suppressed += outcome.suppressed ? 1 : 0;
    disabled += outcome.disabled ? 1 : 0;
  }
  return { due: schedules.length, evaluated, queued, suppressed, disabled };
}

function safeErrorCode(error: unknown): string {
  return isDomainError(error) ? error.code : "INTERNAL";
}

function failureKind(error: unknown): "transient" | "permanent" | "cancelled" {
  if (isDomainError(error) && error.code === "CANCELLED") return "cancelled";
  return !isDomainError(error) || error.retryable ? "transient" : "permanent";
}

function update(
  record: AlertDeliveryRecord,
  values: Omit<AlertDeliveryUpdate, "id" | "updatedAt">,
  now: string,
): AlertDeliveryUpdate {
  return { id: record.id, ...values, updatedAt: now };
}

export async function handleAlertDelivery(
  input: HandleAlertDeliveryInput,
): Promise<AlertDeliveryResult> {
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 10) {
    throw new TypeError("Alert delivery maximum attempts must be between 1 and 10.");
  }
  const delivery = await input.storage.alerts.getDelivery(input.deliveryId);
  if (delivery === null)
    throw new DomainError({ code: "NOT_FOUND", message: "Alert delivery was not found." });
  if (["accepted", "cancelled", "dead"].includes(delivery.status)) {
    return { status: "already_final", deliveryId: delivery.id };
  }
  if (delivery.status === "sending") {
    throw new DomainError({
      code: "CONFLICT",
      message: "Alert delivery is already being sent.",
      retryable: true,
    });
  }
  const endpoint = await input.storage.identity.getVerificationEndpoint(
    delivery.ownerId,
    delivery.endpointId,
  );
  if (endpoint === null || endpoint.status !== "verified") {
    await input.storage.alerts.updateDelivery(
      update(
        delivery,
        {
          status: "cancelled",
          attempt: delivery.attempt,
          providerRef: null,
          errorCode: "ENDPOINT_UNVERIFIED",
          acceptedAt: null,
          lastAttemptAt: input.now,
        },
        input.now,
      ),
      delivery.version,
    );
    return { status: "cancelled", deliveryId: delivery.id };
  }
  const attempt = delivery.attempt + 1;
  const sending = await input.storage.alerts.updateDelivery(
    update(
      delivery,
      {
        status: "sending",
        attempt,
        providerRef: null,
        errorCode: null,
        acceptedAt: null,
        lastAttemptAt: input.now,
      },
      input.now,
    ),
    delivery.version,
  );

  try {
    const changes = await input.storage.alerts.listChanges(delivery.evaluationId);
    const sent = await input.sender.send({
      deliveryId: delivery.id,
      endpointId: endpoint.id,
      encryptedAddress: endpoint.addressCiphertext,
      contentHash: delivery.contentHash,
      subject: "Your Jobbbler job update",
      text: `${String(changes.length)} job updates are ready in Jobbbler.`,
    });
    await input.storage.alerts.updateDelivery(
      update(
        sending,
        {
          status: "accepted",
          attempt,
          providerRef: sent.providerRef,
          errorCode: null,
          acceptedAt: input.now,
          lastAttemptAt: input.now,
        },
        input.now,
      ),
      sending.version,
    );
    return { status: "accepted", deliveryId: delivery.id };
  } catch (error) {
    const decision = classifyNotificationRetry({
      attempt,
      maxAttempts: input.maxAttempts,
      failure: { kind: failureKind(error) },
    });
    if (decision.action === "cancelled") {
      await input.storage.alerts.updateDelivery(
        update(
          sending,
          {
            status: "cancelled",
            attempt,
            providerRef: null,
            errorCode: safeErrorCode(error),
            acceptedAt: null,
            lastAttemptAt: input.now,
          },
          input.now,
        ),
        sending.version,
      );
      return { status: "cancelled", deliveryId: delivery.id };
    }
    if (decision.action === "dead") {
      await input.storage.alerts.updateDelivery(
        update(
          sending,
          {
            status: "dead",
            attempt,
            providerRef: null,
            errorCode: safeErrorCode(error),
            acceptedAt: null,
            lastAttemptAt: input.now,
          },
          input.now,
        ),
        sending.version,
      );
      return { status: "dead", deliveryId: delivery.id };
    }
    await input.storage.alerts.updateDelivery(
      update(
        sending,
        {
          status: "failed",
          attempt,
          providerRef: null,
          errorCode: safeErrorCode(error),
          acceptedAt: null,
          lastAttemptAt: input.now,
        },
        input.now,
      ),
      sending.version,
    );
    throw new DomainError({
      code: "DEPENDENCY",
      message: "Alert delivery is temporarily unavailable.",
      retryable: true,
      details: { retryAt: addSeconds(input.now, decision.delaySeconds) },
      cause: error,
    });
  }
}

export async function runAlertDeliveryBatch(
  input: RunAlertDeliveryBatchInput,
): Promise<WorkBatchResult> {
  return runWorkBatch({
    storage: input.storage,
    workerId: input.workerId,
    now: input.now,
    leaseSeconds: 120,
    limit: input.limit,
    kinds: ["alert_delivery"],
    signal: input.signal,
    ...(input.random === undefined ? {} : { random: input.random }),
    handle: async (item) => {
      if (item.kind !== "alert_delivery") {
        throw new DomainError({
          code: "VALIDATION",
          message: "Alert worker received an unsupported work-item kind.",
        });
      }
      const deliveryId = item.payload["deliveryId"];
      if (typeof deliveryId !== "string" || deliveryId.length < 1 || deliveryId.length > 160) {
        throw new DomainError({
          code: "VALIDATION",
          message: "Alert delivery work has an invalid delivery identifier.",
        });
      }
      await handleAlertDelivery({
        storage: {
          alerts: input.storage.alerts,
          identity: input.storage.identity,
        },
        deliveryId,
        now: input.now,
        maxAttempts: item.maxAttempts,
        sender: input.sender,
      });
    },
  });
}
