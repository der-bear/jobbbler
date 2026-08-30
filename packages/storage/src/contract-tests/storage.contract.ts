import { afterEach, describe, expect, it } from "vitest";

import type { ApplicationDraft, Job, JobSearchCriteria } from "@jobbbler/contracts";

import type {
  AuditEventRecord,
  IdempotencyRecord,
  OrganizationRecord,
  OwnerActivityEventRecord,
  OwnerRecord,
  PersistSourceObservationInput,
  SavedSearchRecord,
  ScheduleRecord,
  SourceRunRecord,
  Storage,
  WorkItemRecord,
} from "../index.js";

export type StorageFactory = () => Promise<Storage>;

const now = "2026-08-29T10:00:00.000Z";
const later = "2026-08-29T10:05:00.000Z";

const owner: OwnerRecord = {
  id: "owner_550e8400-e29b-41d4-a716-446655440000",
  kind: "guest",
  verified: true,
  version: 1,
  createdAt: now,
  updatedAt: now,
};

const organization: OrganizationRecord = {
  id: "org_550e8400-e29b-41d4-a716-446655440000",
  name: "Northstar Systems",
  slug: "northstar-systems",
  website: null,
  description: "A fictional workflow software company.",
  createdAt: now,
  updatedAt: now,
};

const job: Job = {
  id: "job_550e8400-e29b-41d4-a716-446655440000",
  organizationId: organization.id,
  organizationName: organization.name,
  title: "Senior TypeScript Engineer",
  summary: "Build an explainable workflow product for engineering teams.",
  categories: ["software_engineering"],
  workModel: "remote",
  employmentType: "full_time",
  seniority: "senior",
  locations: ["Europe"],
  skills: ["TypeScript", "React", "PostgreSQL"],
  salary: {
    minimum: 110_000,
    maximum: 135_000,
    currency: "EUR",
    period: "year",
  },
  source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
  applyMode: "internal",
  status: "open",
  publishedAt: "2026-08-28T09:00:00.000Z",
  updatedAt: now,
};

const emptyCriteria: JobSearchCriteria = {
  query: null,
  categories: [],
  workModels: [],
  seniorities: [],
  locations: [],
  skills: [],
  excludeKeywords: [],
  salary: null,
  postedWithinDays: null,
  sort: "relevance",
  cursor: null,
  limit: 20,
  unresolvedAssumptions: [],
};

function ingestionRun(id: string, startedAt: string): SourceRunRecord {
  return {
    id,
    sourceKey: "jobicy",
    partition: "default",
    purpose: "production",
    status: "running",
    policyVersion: 1,
    startedAt,
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

function ingestionObservation(
  runId: string,
  rawHash: string,
  sourceUpdatedAt: string,
  applyMode: Job["applyMode"],
): PersistSourceObservationInput {
  const sourceJob: Job = {
    ...job,
    source: {
      key: "jobicy",
      label: "Jobicy",
      url: "https://jobicy.example/jobs/contract-100",
    },
    applyMode,
    updatedAt: sourceUpdatedAt,
  };
  return {
    runId,
    evidence: {
      sourceKey: "jobicy",
      partition: "default",
      externalId: "contract-100",
      originalUrl: "https://jobicy.example/jobs/contract-100",
      applyUrl: "https://jobicy.example/jobs/contract-100/apply",
      sourceUpdatedAt,
      fetchedAt: sourceUpdatedAt,
      retainedUntil: "2026-09-29T10:00:00.000Z",
      rawHash,
      payload: { id: "contract-100", title: sourceJob.title },
      policyVersion: 1,
      attribution: {
        label: "Jobicy",
        url: "https://jobicy.com/",
        required: true,
        followedLinkRequired: false,
      },
    },
    normalization: {
      accepted: true,
      normalizerVersion: 1,
      recordedAt: sourceUpdatedAt,
      organization,
      job: sourceJob,
      sourceLink: {
        originalUrl: "https://jobicy.example/jobs/contract-100",
        applyUrl: "https://jobicy.example/jobs/contract-100/apply",
        identityBasis: "source_id",
      },
    },
  };
}

export function storageContractSuite(name: string, createStorage: StorageFactory): void {
  describe(`${name} storage contract`, () => {
    let storage: Storage | undefined;

    afterEach(() => {
      storage?.close();
      storage = undefined;
    });

    async function create(): Promise<Storage> {
      storage = await createStorage();
      return storage;
    }

    it("round-trips a job and finds it through lexical search", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      await current.jobs.upsert(job);

      expect(await current.jobs.getById(job.id)).toEqual(job);
      expect(
        await current.jobs.search({
          criteria: { ...emptyCriteria, query: "TypeScript workflow" },
          now,
          limit: 10,
        }),
      ).toEqual({ jobs: [job], total: 1, nextCursor: null, catalogUpdatedAt: now });
    });

    it("keeps a job's application mode immutable across upserts", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      await current.jobs.upsert(job);

      await expect(
        current.jobs.upsert({
          ...job,
          applyMode: "external",
          source: {
            key: "external_source",
            label: "External source",
            url: "https://jobs.example.test/opening/42",
          },
          updatedAt: later,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(current.jobs.getById(job.id)).resolves.toEqual(job);
    });

    it("rolls back an ingestion observation that changes an existing job's application mode", async () => {
      const current = await create();
      const original = ingestionObservation("run_contract_mode_1", "a".repeat(64), now, "external");
      await current.ingestion.insertRun(ingestionRun(original.runId, now));
      await current.ingestion.persistObservation(original);
      await current.ingestion.insertRun(ingestionRun("run_contract_mode_2", later));

      const conflicting = ingestionObservation(
        "run_contract_mode_2",
        "b".repeat(64),
        later,
        "internal",
      );
      if (!conflicting.normalization.accepted) throw new Error("Expected an accepted fixture.");
      const changedOrganization = {
        ...conflicting.normalization.organization,
        description: "This write must roll back with the rejected observation.",
        updatedAt: later,
      };

      await expect(
        current.ingestion.persistObservation({
          ...conflicting,
          normalization: { ...conflicting.normalization, organization: changedOrganization },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(current.jobs.getById(job.id)).resolves.toMatchObject({
        applyMode: "external",
        updatedAt: now,
      });
      await expect(current.organizations.getById(organization.id)).resolves.toEqual(organization);
      await expect(current.ingestion.listJobVersions(job.id)).resolves.toHaveLength(1);
      await expect(current.ingestion.listJobSourceLinks(job.id)).resolves.toEqual([
        expect.objectContaining({
          latestRawHash: "a".repeat(64),
          latestSourceUpdatedAt: now,
        }),
      ]);
      await expect(
        current.ingestion.persistObservation(
          ingestionObservation("run_contract_mode_2", "b".repeat(64), later, "external"),
        ),
      ).resolves.toMatchObject({
        sourceRecordInserted: true,
        normalizationInserted: true,
      });
    });

    it("suggests distinct open-role locations by relevance without loading the catalog", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      await current.jobs.upsert(job);
      await current.jobs.upsert({
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440011",
        locations: ["Berlin, Germany", "Europe"],
      });
      await current.jobs.upsert({
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440012",
        locations: ["Paris, France"],
        status: "closed",
      });

      await expect(current.jobs.suggestLocations("", 8)).resolves.toEqual([]);
      await expect(current.jobs.suggestLocations("ber", 8)).resolves.toEqual(["Berlin, Germany"]);
    });

    it("applies hard structured filters after lexical retrieval", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      await current.jobs.upsert(job);

      expect(
        await current.jobs.search({
          criteria: {
            ...emptyCriteria,
            query: "TypeScript",
            workModels: ["remote"],
            seniorities: ["senior"],
            locations: ["Europe"],
            postedWithinDays: 2,
          },
          now,
          limit: 10,
        }),
      ).toEqual({ jobs: [job], total: 1, nextCursor: null, catalogUpdatedAt: now });
      expect(
        await current.jobs.search({
          criteria: { ...emptyCriteria, seniorities: ["entry"] },
          now,
          limit: 10,
        }),
      ).toEqual({ jobs: [], total: 0, nextCursor: null, catalogUpdatedAt: null });
    });

    it("treats untrusted lexical syntax as text instead of executable FTS syntax", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      await current.jobs.upsert(job);

      await expect(
        current.jobs.search({
          criteria: { ...emptyCriteria, query: 'TypeScript" OR *' },
          now,
          limit: 10,
        }),
      ).resolves.toEqual({ jobs: [], total: 0, nextCursor: null, catalogUpdatedAt: null });
    });

    it("paginates a stable sort without duplicates", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const second = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440001",
        publishedAt: "2026-08-27T09:00:00.000Z",
      };
      const third = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440002",
        publishedAt: "2026-08-26T09:00:00.000Z",
      };
      await current.jobs.upsert(job);
      await current.jobs.upsert(second);
      await current.jobs.upsert(third);

      const firstPage = await current.jobs.search({
        criteria: { ...emptyCriteria, sort: "newest", limit: 2 },
        now,
        limit: 2,
      });
      expect(firstPage.jobs.map(({ id }) => id)).toEqual([job.id, second.id]);
      expect(firstPage.total).toBe(3);
      expect(firstPage.catalogUpdatedAt).toBe(now);
      expect(firstPage.nextCursor).toEqual(expect.any(String));

      const secondPage = await current.jobs.search({
        criteria: {
          ...emptyCriteria,
          sort: "newest",
          cursor: firstPage.nextCursor,
          limit: 2,
        },
        now,
        limit: 2,
      });
      expect(secondPage).toEqual({
        jobs: [third],
        total: 3,
        nextCursor: null,
        catalogUpdatedAt: now,
      });
    });

    it("rejects a malformed or mismatched search cursor", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      await current.jobs.upsert(job);

      await expect(
        current.jobs.search({
          criteria: { ...emptyCriteria, cursor: "not-a-valid-cursor" },
          now,
          limit: 10,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("rejects a stale saved-search expectedVersion", async () => {
      const current = await create();
      await current.owners.insert(owner);
      const saved: SavedSearchRecord = {
        id: "search_550e8400-e29b-41d4-a716-446655440000",
        ownerId: owner.id,
        name: "Product engineering",
        criteria: emptyCriteria,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await current.savedSearches.insert(saved);
      const updated = await current.savedSearches.update(
        { ...saved, name: "Senior product engineering", updatedAt: later },
        1,
      );
      expect(updated.version).toBe(2);

      await expect(
        current.savedSearches.update({ ...saved, name: "Stale write", updatedAt: later }, 1),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lists only the current owner's application drafts in recent order", async () => {
      const current = await create();
      const otherOwner: OwnerRecord = {
        ...owner,
        id: "owner_550e8400-e29b-41d4-a716-446655440001",
      };
      await current.owners.insert(owner);
      await current.owners.insert(otherOwner);
      await current.organizations.upsert(organization);
      await current.jobs.upsert(job);

      const oldest: ApplicationDraft = {
        id: "application_550e8400-e29b-41d4-a716-446655440000",
        ownerId: owner.id,
        jobId: job.id,
        state: "draft",
        version: 0,
        answers: [],
        createdAt: now,
        updatedAt: now,
      };
      const newest: ApplicationDraft = {
        ...oldest,
        id: "application_550e8400-e29b-41d4-a716-446655440001",
        state: "reviewed",
        createdAt: later,
        updatedAt: later,
      };
      const privateToOtherOwner: ApplicationDraft = {
        ...oldest,
        id: "application_550e8400-e29b-41d4-a716-446655440002",
        ownerId: otherOwner.id,
      };
      await current.applications.insert(oldest);
      await current.applications.insert(newest);
      await current.applications.insert(privateToOtherOwner);

      const listByOwner = (
        current.applications as typeof current.applications & {
          listByOwner(ownerId: string): Promise<ApplicationDraft[]>;
        }
      ).listByOwner;
      await expect(listByOwner.call(current.applications, owner.id)).resolves.toEqual([
        newest,
        oldest,
      ]);
    });

    it("lists schedules only for their owner in most-recent-first order", async () => {
      const current = await create();
      await current.owners.insert(owner);
      const saved: SavedSearchRecord = {
        id: "search_550e8400-e29b-41d4-a716-446655440010",
        ownerId: owner.id,
        name: "Remote product engineering",
        criteria: emptyCriteria,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await current.savedSearches.insert(saved);
      const secondSaved: SavedSearchRecord = {
        ...saved,
        id: "search_550e8400-e29b-41d4-a716-446655440011",
        name: "Remote platform engineering",
      };
      await current.savedSearches.insert(secondSaved);
      const first: ScheduleRecord = {
        id: "schedule_550e8400-e29b-41d4-a716-446655440000",
        ownerId: owner.id,
        savedSearchId: saved.id,
        recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
        deliveryChannel: "email",
        deliveryEndpointId: "endpoint_550e8400-e29b-41d4-a716-446655440000",
        enabled: true,
        nextRunAt: later,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const second: ScheduleRecord = {
        ...first,
        id: "schedule_550e8400-e29b-41d4-a716-446655440001",
        savedSearchId: secondSaved.id,
        updatedAt: later,
      };
      await current.schedules.insert(first);
      await current.schedules.insert(second);

      await expect(current.schedules.listByOwner(owner.id)).resolves.toEqual([second, first]);
      await expect(current.schedules.listByOwner("another-owner")).resolves.toEqual([]);
    });

    it("allows only one owner schedule for a saved search", async () => {
      const current = await create();
      await current.owners.insert(owner);
      const saved: SavedSearchRecord = {
        id: "search_550e8400-e29b-41d4-a716-446655440012",
        ownerId: owner.id,
        name: "One schedule only",
        criteria: emptyCriteria,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const schedule: ScheduleRecord = {
        id: "schedule_550e8400-e29b-41d4-a716-446655440012",
        ownerId: owner.id,
        savedSearchId: saved.id,
        recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
        deliveryChannel: "email",
        deliveryEndpointId: "endpoint_550e8400-e29b-41d4-a716-446655440012",
        enabled: true,
        nextRunAt: later,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      await current.savedSearches.insert(saved);
      await current.schedules.insert(schedule);

      await expect(
        current.schedules.insert({
          ...schedule,
          id: "schedule_550e8400-e29b-41d4-a716-446655440013",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("deletes a saved search together with its schedule and alert artifacts", async () => {
      const current = await create();
      await current.owners.insert(owner);
      await current.organizations.upsert(organization);
      await current.jobs.upsert(job);
      const saved: SavedSearchRecord = {
        id: "search_550e8400-e29b-41d4-a716-446655440030",
        ownerId: owner.id,
        name: "Remove me",
        criteria: emptyCriteria,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      const kept: SavedSearchRecord = {
        ...saved,
        id: "search_550e8400-e29b-41d4-a716-446655440031",
        name: "Keep me",
      };
      await current.savedSearches.insert(saved);
      await current.savedSearches.insert(kept);
      const schedule: ScheduleRecord = {
        id: "schedule_550e8400-e29b-41d4-a716-446655440030",
        ownerId: owner.id,
        savedSearchId: saved.id,
        recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
        deliveryChannel: "email",
        deliveryEndpointId: "endpoint_550e8400-e29b-41d4-a716-446655440030",
        enabled: true,
        nextRunAt: later,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      await current.schedules.insert(schedule);
      const evaluation = {
        id: "evaluation_550e8400-e29b-41d4-a716-446655440030",
        ownerId: owner.id,
        savedSearchId: saved.id,
        scheduleId: schedule.id,
        catalogUpdatedAt: now,
        createdAt: now,
        baseline: [{ jobId: job.id, fingerprint: "c".repeat(64) }],
      };
      await current.alerts.insertEvaluation({
        evaluation,
        changes: [
          {
            id: "change_550e8400-e29b-41d4-a716-446655440030",
            evaluationId: evaluation.id,
            jobId: job.id,
            kind: "new" as const,
            createdAt: now,
          },
        ],
      });
      await current.alerts.putDeliveryIfAbsent({
        id: "delivery_550e8400-e29b-41d4-a716-446655440030",
        evaluationId: evaluation.id,
        ownerId: owner.id,
        scheduleId: schedule.id,
        endpointId: schedule.deliveryEndpointId,
        contentHash: "d".repeat(64),
        status: "pending",
        attempt: 0,
        providerRef: null,
        errorCode: null,
        acceptedAt: null,
        lastAttemptAt: null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      });

      await expect(current.savedSearches.delete(saved.id)).resolves.toBe(true);

      await expect(current.savedSearches.getById(saved.id)).resolves.toBeNull();
      await expect(current.savedSearches.listByOwner(owner.id)).resolves.toEqual([kept]);
      await expect(current.schedules.getById(schedule.id)).resolves.toBeNull();
      await expect(current.schedules.listByOwner(owner.id)).resolves.toEqual([]);
      await expect(current.alerts.getLatestEvaluation(saved.id)).resolves.toBeNull();
      await expect(current.alerts.listChanges(evaluation.id)).resolves.toEqual([]);
      await expect(current.alerts.getLatestDelivery(schedule.id)).resolves.toBeNull();
      await expect(current.savedSearches.delete(saved.id)).resolves.toBe(false);
    });

    it("keeps alert evaluations immutable and deduplicates content-bound deliveries", async () => {
      const current = await create();
      await current.owners.insert(owner);
      await current.organizations.upsert(organization);
      await current.jobs.upsert(job);
      const saved: SavedSearchRecord = {
        id: "search_550e8400-e29b-41d4-a716-446655440020",
        ownerId: owner.id,
        name: "Senior remote roles",
        criteria: emptyCriteria,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await current.savedSearches.insert(saved);
      const schedule: ScheduleRecord = {
        id: "schedule_550e8400-e29b-41d4-a716-446655440020",
        ownerId: owner.id,
        savedSearchId: saved.id,
        recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
        deliveryChannel: "email",
        deliveryEndpointId: "endpoint_550e8400-e29b-41d4-a716-446655440020",
        enabled: true,
        nextRunAt: later,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await current.schedules.insert(schedule);
      const evaluation = {
        id: "evaluation_550e8400-e29b-41d4-a716-446655440000",
        ownerId: owner.id,
        savedSearchId: saved.id,
        scheduleId: schedule.id,
        catalogUpdatedAt: now,
        createdAt: now,
        baseline: [{ jobId: job.id, fingerprint: "a".repeat(64) }],
      };
      const change = {
        id: "change_550e8400-e29b-41d4-a716-446655440000",
        evaluationId: evaluation.id,
        jobId: job.id,
        kind: "no_longer_matching" as const,
        createdAt: now,
      };
      await current.alerts.insertEvaluation({ evaluation, changes: [change] });

      await expect(current.alerts.getLatestEvaluation(saved.id)).resolves.toEqual(evaluation);
      await expect(current.alerts.listChanges(evaluation.id)).resolves.toEqual([change]);
      await expect(
        current.alerts.insertEvaluation({
          evaluation: {
            ...evaluation,
            id: "evaluation_550e8400-e29b-41d4-a716-446655440001",
            createdAt: later,
          },
          changes: [
            {
              ...change,
              id: "change_550e8400-e29b-41d4-a716-446655440001",
              evaluationId: "evaluation_550e8400-e29b-41d4-a716-446655440001",
              jobId: "job_missing",
              createdAt: later,
            },
          ],
        }),
      ).rejects.toThrow();
      await expect(current.alerts.getLatestEvaluation(saved.id)).resolves.toEqual(evaluation);
      const delivery = {
        id: "delivery_550e8400-e29b-41d4-a716-446655440000",
        evaluationId: evaluation.id,
        ownerId: owner.id,
        scheduleId: schedule.id,
        endpointId: schedule.deliveryEndpointId,
        contentHash: "b".repeat(64),
        status: "pending" as const,
        attempt: 0,
        providerRef: null,
        errorCode: null,
        acceptedAt: null,
        lastAttemptAt: null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      await expect(current.alerts.putDeliveryIfAbsent(delivery)).resolves.toEqual({
        inserted: true,
        record: delivery,
      });
      await expect(
        current.alerts.putDeliveryIfAbsent({ ...delivery, id: "delivery_duplicate" }),
      ).resolves.toEqual({ inserted: false, record: delivery });
      await expect(
        current.alerts.updateDelivery(
          {
            id: delivery.id,
            status: "accepted",
            attempt: 1,
            providerRef: "provider-accepted-1",
            errorCode: null,
            acceptedAt: later,
            lastAttemptAt: later,
            updatedAt: later,
          },
          0,
        ),
      ).resolves.toMatchObject({
        status: "accepted",
        version: 1,
        acceptedAt: later,
        lastAttemptAt: later,
      });
      await expect(current.alerts.getLatestDelivery(schedule.id)).resolves.toMatchObject({
        id: delivery.id,
        status: "accepted",
        version: 1,
      });
      await expect(
        current.alerts.updateDelivery(
          {
            id: delivery.id,
            status: "failed",
            attempt: 1,
            providerRef: null,
            errorCode: "PROVIDER",
            acceptedAt: null,
            lastAttemptAt: later,
            updatedAt: later,
          },
          0,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("claims one due work item once during an active lease", async () => {
      const current = await create();
      const work: WorkItemRecord = {
        id: "work_550e8400-e29b-41d4-a716-446655440000",
        kind: "catalog_ingest",
        payload: { source: "jobbbler_demo" },
        status: "pending",
        availableAt: now,
        attempt: 0,
        maxAttempts: 3,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now,
      };
      await current.workItems.insert(work);
      await expect(current.workItems.putIfAbsent(work)).resolves.toEqual({
        inserted: false,
        record: work,
      });
      await expect(
        current.workItems.putIfAbsent({ ...work, payload: { source: "remoteok" } }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const claimed = await current.workItems.claimDue({
        workerId: "worker-a",
        now,
        leaseExpiresAt: later,
        limit: 10,
      });
      const secondClaim = await current.workItems.claimDue({
        workerId: "worker-b",
        now,
        leaseExpiresAt: later,
        limit: 10,
      });

      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({ status: "running", leaseOwner: "worker-a" });
      expect(secondClaim).toEqual([]);
    });

    it("claims only validated requested work-item kinds", async () => {
      const current = await create();
      const catalog: WorkItemRecord = {
        id: "work_550e8400-e29b-41d4-a716-446655440020",
        kind: "catalog_ingest",
        payload: { source: "jobbbler_demo" },
        status: "pending",
        availableAt: now,
        attempt: 0,
        maxAttempts: 3,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now,
      };
      const alert: WorkItemRecord = {
        ...catalog,
        id: "work_550e8400-e29b-41d4-a716-446655440021",
        kind: "alert_evaluate",
      };
      await current.workItems.insert(catalog);
      await current.workItems.insert(alert);

      await expect(
        current.workItems.claimDue({
          workerId: "alert-worker",
          now,
          leaseExpiresAt: later,
          limit: 10,
          kinds: ["alert_evaluate"],
        }),
      ).resolves.toMatchObject([{ id: alert.id, kind: "alert_evaluate" }]);
      await expect(
        current.workItems.claimDue({
          workerId: "worker",
          now,
          leaseExpiresAt: later,
          limit: 10,
          kinds: [],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("persists atomic rate-limit windows", async () => {
      const current = await create();
      const input = { key: "hmac:requester", limit: 2, windowMs: 60_000, nowMs: 1_000 };

      await expect(current.rateLimits.check(input)).resolves.toEqual({
        allowed: true,
        remaining: 1,
        retryAfterSeconds: 0,
        resetAtMs: 61_000,
      });
      await expect(current.rateLimits.check(input)).resolves.toMatchObject({
        allowed: true,
        remaining: 0,
      });
      await expect(current.rateLimits.check(input)).resolves.toEqual({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 60,
        resetAtMs: 61_000,
      });
      await expect(current.rateLimits.check({ ...input, nowMs: 61_000 })).resolves.toMatchObject({
        allowed: true,
        remaining: 1,
        resetAtMs: 121_000,
      });
    });

    it("renews only the active owner's lease", async () => {
      const current = await create();
      const work: WorkItemRecord = {
        id: "work_550e8400-e29b-41d4-a716-446655440005",
        kind: "catalog_ingest",
        payload: { source: "jobicy" },
        status: "pending",
        availableAt: now,
        attempt: 0,
        maxAttempts: 3,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now,
      };
      await current.workItems.insert(work);
      await current.workItems.claimDue({
        workerId: "worker-a",
        now,
        leaseExpiresAt: later,
        limit: 1,
      });

      await expect(
        current.workItems.renewLease({
          id: work.id,
          workerId: "worker-b",
          now: "2026-08-29T10:01:00.000Z",
          leaseExpiresAt: "2026-08-29T10:10:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        current.workItems.renewLease({
          id: work.id,
          workerId: "worker-a",
          now: "2026-08-29T10:01:00.000Z",
          leaseExpiresAt: "2026-08-29T10:10:00.000Z",
        }),
      ).resolves.toMatchObject({
        status: "running",
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-08-29T10:10:00.000Z",
      });
    });

    it("requires the active lease to complete or reschedule work", async () => {
      const current = await create();
      const work: WorkItemRecord = {
        id: "work_550e8400-e29b-41d4-a716-446655440010",
        kind: "catalog_ingest",
        payload: { source: "jobicy" },
        status: "pending",
        availableAt: now,
        attempt: 0,
        maxAttempts: 2,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now,
      };
      await current.workItems.insert(work);
      await current.workItems.claimDue({
        workerId: "worker-a",
        now,
        leaseExpiresAt: later,
        limit: 1,
      });

      await expect(current.workItems.complete(work.id, "worker-b", now)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      const failed = await current.workItems.fail({
        id: work.id,
        workerId: "worker-a",
        now,
        retryAt: later,
        errorCode: "DEPENDENCY",
        terminal: false,
      });
      expect(failed).toMatchObject({
        status: "failed",
        attempt: 1,
        availableAt: later,
        leaseOwner: null,
      });

      const finalLeaseAt = "2026-08-29T10:10:00.000Z";
      await current.workItems.claimDue({
        workerId: "worker-b",
        now: later,
        leaseExpiresAt: finalLeaseAt,
        limit: 1,
      });
      const dead = await current.workItems.fail({
        id: work.id,
        workerId: "worker-b",
        now: later,
        retryAt: "2026-08-29T10:15:00.000Z",
        errorCode: "DEPENDENCY",
        terminal: false,
      });
      expect(dead).toMatchObject({ status: "dead", attempt: 2, availableAt: later });
      await expect(current.workItems.getById(work.id)).resolves.toEqual(dead);
    });

    it("keeps idempotency keys bound to one request hash", async () => {
      const current = await create();
      const record: IdempotencyRecord = {
        scope: "application.submit",
        key: "550e8400-e29b-41d4-a716-446655440000",
        requestHash: "a".repeat(64),
        responseStatus: 201,
        responseBody: { receiptId: "receipt-1" },
        createdAt: now,
        expiresAt: "2026-08-30T10:00:00.000Z",
      };

      expect(await current.idempotency.putIfAbsent(record)).toEqual({
        inserted: true,
        record,
      });
      expect(await current.idempotency.putIfAbsent(record)).toEqual({
        inserted: false,
        record,
      });
      await expect(
        current.idempotency.putIfAbsent({ ...record, requestHash: "b".repeat(64) }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("appends audit events in stable order", async () => {
      const current = await create();
      const first: AuditEventRecord = {
        id: "audit_550e8400-e29b-41d4-a716-446655440000",
        type: "agent.delegation_requested",
        actorKind: "agent",
        actorId: null,
        aggregateType: "application_draft",
        aggregateId: "draft_550e8400-e29b-41d4-a716-446655440000",
        correlationId: "corr_550e8400-e29b-41d4-a716-446655440000",
        safeMetadata: { operations: ["read_application"] },
        occurredAt: now,
      };
      const second: AuditEventRecord = {
        ...first,
        id: "audit_550e8400-e29b-41d4-a716-446655440001",
        type: "agent.delegation_approved",
        occurredAt: later,
      };
      await current.audit.append(first);
      await current.audit.append(second);

      expect(
        await current.audit.listForAggregate(first.aggregateType, first.aggregateId, 10),
      ).toEqual([first, second]);
    });

    it("keeps the sanitized activity cursor projection strictly owner-scoped", async () => {
      const current = await create();
      const otherOwner: OwnerRecord = {
        ...owner,
        id: "owner_550e8400-e29b-41d4-a716-446655440001",
      };
      await current.owners.insert(owner);
      await current.owners.insert(otherOwner);
      const first = await current.ownerActivity.append({
        ownerId: owner.id,
        event: {
          id: "activity_550e8400-e29b-41d4-a716-446655440000",
          schemaVersion: 1,
          kind: "tool",
          key: "edit_application",
          status: "completed",
          safeSummary: "Application draft updated.",
          correlationId: "corr_550e8400-e29b-41d4-a716-446655440000",
          actorKind: "agent",
          aggregate: { type: "application_draft", version: 3 },
          occurredAt: now,
          effects: [{ target: "application", kind: "refresh" }],
        },
      });
      const other = await current.ownerActivity.append({
        ownerId: otherOwner.id,
        event: {
          ...first.event,
          id: "activity_550e8400-e29b-41d4-a716-446655440001",
          correlationId: "corr_550e8400-e29b-41d4-a716-446655440001",
        },
      });
      const second: OwnerActivityEventRecord = await current.ownerActivity.append({
        ownerId: owner.id,
        event: {
          ...first.event,
          id: "activity_550e8400-e29b-41d4-a716-446655440002",
          key: "review_application",
          status: "requires_user_action",
          safeSummary: "Application review needs your approval.",
          correlationId: "corr_550e8400-e29b-41d4-a716-446655440002",
          aggregate: { type: "application_draft", version: 4 },
          occurredAt: later,
          effects: [{ target: "application", kind: "focus" }],
        },
      });

      expect(first.sequence).toBeGreaterThan(0);
      expect(second.sequence).toBeGreaterThan(first.sequence);
      expect(
        await current.ownerActivity.listWindow({
          ownerId: owner.id,
          afterSequence: null,
          limit: 10,
        }),
      ).toEqual({ events: [first, second], hasMore: false, latestSequence: second.sequence });
      expect(
        await current.ownerActivity.listWindow({
          ownerId: owner.id,
          afterSequence: first.sequence,
          limit: 10,
        }),
      ).toEqual({ events: [second], hasMore: false, latestSequence: second.sequence });
      expect(
        await current.ownerActivity.listWindow({
          ownerId: otherOwner.id,
          afterSequence: second.sequence,
          limit: 10,
        }),
      ).toEqual({ events: [], hasMore: false, latestSequence: other.sequence });
      await expect(
        current.ownerActivity.append({
          ownerId: owner.id,
          event: {
            ...first.event,
            id: "activity_550e8400-e29b-41d4-a716-446655440003",
            safeSummary: "Token=private-secret-with-at-least-thirty-two-characters",
          },
        }),
      ).rejects.toThrow();
    });
  });
}
