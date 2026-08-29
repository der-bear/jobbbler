import type { ApplicationDraft, Job } from "@jobbbler/contracts";

import type {
  AuditEventRecord,
  ClaimWorkItemsInput,
  FailWorkItemInput,
  IdempotencyPutResult,
  IdempotencyRecord,
  JobSearchPage,
  JobSearchQuery,
  OrganizationRecord,
  OwnerRecord,
  PersistSourceObservationInput,
  PersistSourceObservationResult,
  RenewWorkItemLeaseInput,
  SavedSearchRecord,
  ScheduleRecord,
  SourceRunRecord,
  SourceStateInput,
  SourceStateRecord,
  StoredSourceEvidence,
  JobSourceLinkRecord,
  JobVersionRecord,
  SourceReconciliationResult,
  WorkItemRecord,
  WorkItemPutResult,
} from "./records.js";

export interface OwnerRepository {
  insert(record: OwnerRecord): Promise<OwnerRecord>;
  getById(id: string): Promise<OwnerRecord | null>;
}

export interface OrganizationRepository {
  upsert(record: OrganizationRecord): Promise<OrganizationRecord>;
  getById(id: string): Promise<OrganizationRecord | null>;
}

export interface JobRepository {
  upsert(record: Job): Promise<Job>;
  getById(id: string): Promise<Job | null>;
  search(query: JobSearchQuery): Promise<JobSearchPage>;
  listAll(): Promise<Job[]>;
}

export interface SavedSearchRepository {
  insert(record: SavedSearchRecord): Promise<SavedSearchRecord>;
  getById(id: string): Promise<SavedSearchRecord | null>;
  listByOwner(ownerId: string): Promise<SavedSearchRecord[]>;
  update(record: SavedSearchRecord, expectedVersion: number): Promise<SavedSearchRecord>;
}

export interface ScheduleRepository {
  insert(record: ScheduleRecord): Promise<ScheduleRecord>;
  getById(id: string): Promise<ScheduleRecord | null>;
  listDue(now: string, limit: number): Promise<ScheduleRecord[]>;
  update(record: ScheduleRecord, expectedVersion: number): Promise<ScheduleRecord>;
}

export interface ApplicationRepository {
  insert(record: ApplicationDraft): Promise<ApplicationDraft>;
  getById(id: string): Promise<ApplicationDraft | null>;
  update(record: ApplicationDraft, expectedVersion: number): Promise<ApplicationDraft>;
}

export interface WorkItemRepository {
  insert(record: WorkItemRecord): Promise<WorkItemRecord>;
  putIfAbsent(record: WorkItemRecord): Promise<WorkItemPutResult>;
  getById(id: string): Promise<WorkItemRecord | null>;
  claimDue(input: ClaimWorkItemsInput): Promise<WorkItemRecord[]>;
  renewLease(input: RenewWorkItemLeaseInput): Promise<WorkItemRecord>;
  complete(id: string, workerId: string, now: string): Promise<WorkItemRecord>;
  fail(input: FailWorkItemInput): Promise<WorkItemRecord>;
}

export interface AuditRepository {
  append(record: AuditEventRecord): Promise<AuditEventRecord>;
  listForAggregate(
    aggregateType: string,
    aggregateId: string,
    limit: number,
  ): Promise<AuditEventRecord[]>;
}

export interface IdempotencyRepository {
  putIfAbsent(record: IdempotencyRecord): Promise<IdempotencyPutResult>;
  get(scope: string, key: string): Promise<IdempotencyRecord | null>;
}

export interface IngestionRepository {
  insertRun(record: SourceRunRecord): Promise<SourceRunRecord>;
  finishRun(record: SourceRunRecord): Promise<SourceRunRecord>;
  getRunById(id: string): Promise<SourceRunRecord | null>;
  putSourceState(
    input: SourceStateInput,
    expectedVersion: number | null,
  ): Promise<SourceStateRecord>;
  getSourceState(sourceKey: string, partition: string): Promise<SourceStateRecord | null>;
  listSourceStates(): Promise<SourceStateRecord[]>;
  persistObservation(input: PersistSourceObservationInput): Promise<PersistSourceObservationResult>;
  getEvidence(id: string): Promise<StoredSourceEvidence | null>;
  listJobVersions(jobId: string): Promise<JobVersionRecord[]>;
  listJobSourceLinks(jobId: string): Promise<JobSourceLinkRecord[]>;
  reconcileCompletedRun(
    runId: string,
    closeAfterMisses: number,
  ): Promise<SourceReconciliationResult>;
  purgeExpiredPayloads(now: string, limit: number): Promise<number>;
}

export interface Storage {
  readonly owners: OwnerRepository;
  readonly organizations: OrganizationRepository;
  readonly jobs: JobRepository;
  readonly savedSearches: SavedSearchRepository;
  readonly schedules: ScheduleRepository;
  readonly applications: ApplicationRepository;
  readonly workItems: WorkItemRepository;
  readonly audit: AuditRepository;
  readonly idempotency: IdempotencyRepository;
  readonly ingestion: IngestionRepository;
  close(): void;
}
