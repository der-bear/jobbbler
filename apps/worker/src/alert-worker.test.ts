import { describe, expect, it, vi } from "vitest";

import { DomainError } from "@jobbbler/core-domain";
import type {
  AlertDeliveryRecord,
  AlertDeliveryUpdate,
  AlertEvaluationRecord,
  Job,
  ScheduleRecord,
  Storage,
  WorkItemRecord,
} from "@jobbbler/storage";

import { handleAlertDelivery, runAlertDeliveryBatch, runAlertScheduler } from "./alert-worker.js";

const now = "2026-08-29T10:00:00.000Z";

const job: Job = {
  id: "job_550e8400-e29b-41d4-a716-446655440000",
  organizationId: "organization_550e8400-e29b-41d4-a716-446655440000",
  organizationName: "Fictional Systems",
  title: "Senior TypeScript Engineer",
  summary: "Build a fictional application platform.",
  categories: ["software_engineering"],
  workModel: "remote",
  employmentType: "full_time",
  seniority: "senior",
  locations: ["Europe"],
  skills: ["TypeScript"],
  salary: null,
  source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
  applyMode: "internal",
  status: "open",
  publishedAt: now,
  updatedAt: now,
};

const schedule: ScheduleRecord = {
  id: "schedule_550e8400-e29b-41d4-a716-446655440000",
  ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
  savedSearchId: "saved_550e8400-e29b-41d4-a716-446655440000",
  recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
  deliveryChannel: "email",
  deliveryEndpointId: "endpoint_550e8400-e29b-41d4-a716-446655440000",
  enabled: true,
  nextRunAt: "2026-08-29T09:00:00.000Z",
  version: 2,
  createdAt: now,
  updatedAt: now,
};

function verifiedEndpoint() {
  return {
    id: schedule.deliveryEndpointId,
    ownerId: schedule.ownerId,
    kind: "email" as const,
    addressHash: "a".repeat(64),
    addressCiphertext: "sealed:person@example.com",
    maskedAddress: "p•••••@example.com",
    status: "verified" as const,
    verifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function schedulerStorage() {
  const storedEvaluations: AlertEvaluationRecord[] = [];
  const storedChanges: { readonly kind: string; readonly jobId: string }[] = [];
  const queued: { readonly id: string; readonly payload: Readonly<Record<string, unknown>> }[] = [];
  let updatedSchedule: ScheduleRecord | null = null;
  const appendActivity = vi.fn(
    async (record: Parameters<Storage["ownerActivity"]["append"]>[0]) => ({
      sequence: 1,
      ownerId: record.ownerId,
      event: record.event,
    }),
  );
  const previous: AlertEvaluationRecord = {
    id: "evaluation_550e8400-e29b-41d4-a716-446655440000",
    ownerId: schedule.ownerId,
    savedSearchId: schedule.savedSearchId,
    scheduleId: schedule.id,
    catalogUpdatedAt: "2026-08-28T10:00:00.000Z",
    createdAt: "2026-08-28T10:00:00.000Z",
    baseline: [{ jobId: job.id, fingerprint: "outdated" }],
  };
  return {
    storage: {
      schedules: {
        listDue: async () => [schedule],
        update: async (next: ScheduleRecord) => {
          updatedSchedule = next;
          return next;
        },
      },
      savedSearches: {
        getById: async () => ({
          id: schedule.savedSearchId,
          ownerId: schedule.ownerId,
          name: "TypeScript roles",
          criteria: {
            query: null,
            categories: [],
            workModels: [],
            employmentTypes: [],
            seniorities: [],
            locations: [],
            skills: [],
            excludeKeywords: [],
            salary: null,
            postedWithinDays: null,
            sort: "newest" as const,
            cursor: null,
            limit: 50,
            unresolvedAssumptions: [],
          },
          version: 0,
          createdAt: now,
          updatedAt: now,
        }),
      },
      jobs: {
        search: async () => ({ jobs: [job], total: 1, nextCursor: null, catalogUpdatedAt: now }),
        getById: async () => job,
      },
      identity: { getVerificationEndpoint: async () => verifiedEndpoint() },
      alerts: {
        getLatestEvaluation: async () => previous,
        insertEvaluation: async ({
          evaluation,
          changes,
        }: Parameters<Storage["alerts"]["insertEvaluation"]>[0]) => {
          storedEvaluations.push(evaluation);
          storedChanges.push(
            ...changes.map((change) => ({ kind: change.kind, jobId: change.jobId })),
          );
          return evaluation;
        },
        putDeliveryIfAbsent: async (delivery: AlertDeliveryRecord) => ({
          inserted: true,
          record: delivery,
        }),
      },
      workItems: {
        putIfAbsent: async (item: WorkItemRecord) => {
          queued.push({ id: item.id, payload: item.payload });
          return { inserted: true, record: item };
        },
      },
      ownerActivity: { append: appendActivity },
    },
    records: () => ({ storedEvaluations, storedChanges, queued, updatedSchedule, appendActivity }),
  };
}

describe("alert worker slice", () => {
  it("evaluates due verified schedules, persists a deterministic delta, queues one safe delivery, and advances", async () => {
    const current = schedulerStorage();

    const result = await runAlertScheduler({
      storage: current.storage,
      now,
      limit: 10,
    });

    expect(result).toEqual({ due: 1, evaluated: 1, queued: 1, suppressed: 0, disabled: 0 });
    expect(current.records().storedChanges).toEqual([{ jobId: job.id, kind: "updated" }]);
    expect(current.records().storedEvaluations[0]?.baseline).toHaveLength(1);
    expect(current.records().queued).toEqual([
      expect.objectContaining({
        payload: { deliveryId: expect.stringMatching(/^delivery_[a-f0-9]{64}$/u) },
      }),
    ]);
    expect(JSON.stringify(current.records().queued)).not.toContain("person@example.com");
    expect(Date.parse(current.records().updatedSchedule?.nextRunAt ?? "")).toBeGreaterThan(
      Date.parse(now),
    );
    expect(current.records().appendActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: schedule.ownerId,
        event: expect.objectContaining({
          key: "evaluate_job_alert",
          safeSummary: "Alert check found material job changes.",
          actorKind: "service",
        }),
      }),
    );
  });

  it("sends outside persistence updates and records a retryable failure without exposing the address", async () => {
    const delivery: AlertDeliveryRecord = {
      id: "delivery_550e8400-e29b-41d4-a716-446655440000",
      evaluationId: "evaluation_550e8400-e29b-41d4-a716-446655440000",
      ownerId: schedule.ownerId,
      scheduleId: schedule.id,
      endpointId: schedule.deliveryEndpointId,
      contentHash: "c".repeat(64),
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
    const updates: unknown[] = [];
    let stored = delivery;
    const storage = {
      alerts: {
        getDelivery: async () => stored,
        listChanges: async () => [
          {
            id: "change",
            evaluationId: delivery.evaluationId,
            jobId: job.id,
            kind: "updated" as const,
            createdAt: now,
          },
        ],
        updateDelivery: async (update: AlertDeliveryUpdate) => {
          updates.push(update);
          stored = { ...stored, ...update, version: stored.version + 1 };
          return stored;
        },
      },
      identity: { getVerificationEndpoint: async () => verifiedEndpoint() },
    };

    await expect(
      handleAlertDelivery({
        storage,
        deliveryId: delivery.id,
        now,
        maxAttempts: 5,
        sender: {
          send: async () => {
            throw new DomainError({
              code: "DEPENDENCY",
              message: "Provider unavailable.",
              retryable: true,
            });
          },
        },
      }),
    ).rejects.toMatchObject({ code: "DEPENDENCY", retryable: true });

    expect(updates).toEqual([
      expect.objectContaining({ status: "sending", attempt: 1, errorCode: null }),
      expect.objectContaining({ status: "failed", attempt: 1, errorCode: "DEPENDENCY" }),
    ]);
    expect(JSON.stringify(updates)).not.toContain("person@example.com");
  });

  it("claims only alert-delivery work and completes an accepted delivery", async () => {
    const delivery: AlertDeliveryRecord = {
      id: "delivery_550e8400-e29b-41d4-a716-446655440000",
      evaluationId: "evaluation_550e8400-e29b-41d4-a716-446655440000",
      ownerId: schedule.ownerId,
      scheduleId: schedule.id,
      endpointId: schedule.deliveryEndpointId,
      contentHash: "c".repeat(64),
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
    const item: WorkItemRecord = {
      id: "work_alert_delivery",
      kind: "alert_delivery",
      payload: { deliveryId: delivery.id },
      status: "running",
      availableAt: now,
      attempt: 0,
      maxAttempts: 5,
      leaseOwner: "alert-worker",
      leaseExpiresAt: "2026-08-29T10:02:00.000Z",
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    let claim: Record<string, unknown> | null = null;
    let stored = delivery;
    const storage = {
      workItems: {
        claimDue: async (input: Record<string, unknown>) => {
          claim = input;
          return [item];
        },
        complete: async () => item,
        fail: async () => item,
        renewLease: async () => item,
      },
      alerts: {
        getDelivery: async () => stored,
        listChanges: async () => [],
        updateDelivery: async (update: AlertDeliveryUpdate) => {
          stored = { ...stored, ...update, version: stored.version + 1 };
          return stored;
        },
      },
      identity: { getVerificationEndpoint: async () => verifiedEndpoint() },
    } as unknown as Storage;

    const result = await runAlertDeliveryBatch({
      storage,
      now,
      workerId: "alert-worker",
      limit: 10,
      signal: new AbortController().signal,
      sender: { send: async () => ({ providerRef: "provider_1" }) },
    });

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0, dead: 0 });
    expect(claim).toMatchObject({ kinds: ["alert_delivery"] });
    expect(stored).toMatchObject({ status: "accepted", providerRef: "provider_1" });
  });
});
