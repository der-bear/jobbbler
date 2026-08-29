import { afterEach, describe, expect, it } from "vitest";

import type { Job, JobSearchCriteria } from "@jobbbler/contracts";

import type {
  AuditEventRecord,
  IdempotencyRecord,
  OrganizationRecord,
  OwnerRecord,
  SavedSearchRecord,
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
  });
}
