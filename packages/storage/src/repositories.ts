import type { ApplicationDraft, Job } from "@jobbbler/contracts";
import type { IdentityStore } from "@jobbbler/core-domain";

import type {
  AuditEventRecord,
  AlertChangeRecord,
  AlertDeliveryPutResult,
  AlertDeliveryRecord,
  AlertDeliveryUpdate,
  AlertEvaluationRecord,
  ClaimWorkItemsInput,
  FailWorkItemInput,
  IdempotencyPutResult,
  IdempotencyRecord,
  IdempotencyRecordIdentity,
  JobSearchPage,
  JobSearchQuery,
  OrganizationRecord,
  NewOwnerActivityEventRecord,
  OwnerActivityEventRecord,
  OwnerActivityWindow,
  OwnerActivityWindowInput,
  OwnerRecord,
  PersistSourceObservationInput,
  PersistSourceObservationResult,
  RateLimitCheckInput,
  RateLimitDecision,
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
  ApplicationReviewRecord,
  ApplicationConfirmationRecord,
  ApplicationReceiptRecord,
  ManagedApplicationDeliveryRecord,
  MaterialApplicationEditInput,
  SealApplicationReviewInput,
  CompleteApplicationSubmissionInput,
  CompleteApplicationSubmissionResult,
  AgentDelegationRecord,
  DelegationApprovalEvidence,
  DelegationRevocationEvidence,
  DataGrantRecord,
  ActiveDelegationMatchInput,
  ApproveRichDataGrantInput,
  AgentSessionRecord,
  ResolveAgentSessionInput,
  RichDataGrantMatchInput,
  RichDataGrantRecord,
  SearchAlertActivationInput,
  SearchAlertActivationResult,
  BeginApprovedSearchAlertPreparationInput,
  CommitApprovedSearchAlertPreparationInput,
  CompensateSearchAlertPreparationInput,
  DeclineSearchAlertPreparationInput,
  ExpireSearchAlertPreparationInput,
  GrantWithdrawalEvidence,
  PurgeExpiredSearchAlertPreparationsInput,
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
  suggestLocations(query: string, limit: number): Promise<readonly string[]>;
  listAll(): Promise<Job[]>;
}

export interface SavedSearchRepository {
  insert(record: SavedSearchRecord): Promise<SavedSearchRecord>;
  getById(id: string): Promise<SavedSearchRecord | null>;
  listByOwner(ownerId: string): Promise<SavedSearchRecord[]>;
  update(record: SavedSearchRecord, expectedVersion: number): Promise<SavedSearchRecord>;
  /** Deletes the saved search and its dependent schedule and alert rows; false when absent. */
  delete(id: string): Promise<boolean>;
}

export interface ScheduleRepository {
  insert(record: ScheduleRecord): Promise<ScheduleRecord>;
  getById(id: string): Promise<ScheduleRecord | null>;
  listByOwner(ownerId: string): Promise<ScheduleRecord[]>;
  listDue(now: string, limit: number): Promise<ScheduleRecord[]>;
  update(record: ScheduleRecord, expectedVersion: number): Promise<ScheduleRecord>;
}

export interface AlertRepository {
  getLatestEvaluation(savedSearchId: string): Promise<AlertEvaluationRecord | null>;
  insertEvaluation(input: {
    readonly evaluation: AlertEvaluationRecord;
    readonly changes: readonly AlertChangeRecord[];
  }): Promise<AlertEvaluationRecord>;
  listChanges(evaluationId: string): Promise<AlertChangeRecord[]>;
  putDeliveryIfAbsent(record: AlertDeliveryRecord): Promise<AlertDeliveryPutResult>;
  getDelivery(id: string): Promise<AlertDeliveryRecord | null>;
  getLatestDelivery(scheduleId: string): Promise<AlertDeliveryRecord | null>;
  updateDelivery(input: AlertDeliveryUpdate, expectedVersion: number): Promise<AlertDeliveryRecord>;
}

export interface RateLimitRepository {
  check(input: RateLimitCheckInput): Promise<RateLimitDecision>;
}

export interface ApplicationRepository {
  insert(record: ApplicationDraft): Promise<ApplicationDraft>;
  getById(id: string): Promise<ApplicationDraft | null>;
  update(record: ApplicationDraft, expectedVersion: number): Promise<ApplicationDraft>;
  getByOwner(id: string, ownerId: string): Promise<ApplicationDraft | null>;
  getByOwnerAndJob(ownerId: string, jobId: string): Promise<ApplicationDraft | null>;
  listByOwner(ownerId: string): Promise<ApplicationDraft[]>;
  /** Removes one never-submitted draft owned by this person. Submitted work is kept. */
  discardOwned(id: string, ownerId: string): Promise<boolean>;
  getLatestReview(draftId: string, ownerId: string): Promise<ApplicationReviewRecord | null>;
  getLatestReceipt(draftId: string, ownerId: string): Promise<ApplicationReceiptRecord | null>;
  getManagedDelivery(id: string, ownerId: string): Promise<ManagedApplicationDeliveryRecord | null>;
  applyMaterialEdit(input: MaterialApplicationEditInput): Promise<ApplicationDraft>;
  sealReview(
    input: SealApplicationReviewInput,
  ): Promise<{ readonly draft: ApplicationDraft; readonly review: ApplicationReviewRecord }>;
  completeSubmission(
    input: CompleteApplicationSubmissionInput,
  ): Promise<CompleteApplicationSubmissionResult>;
  insertReview(record: ApplicationReviewRecord): Promise<ApplicationReviewRecord>;
  getReview(id: string, ownerId: string): Promise<ApplicationReviewRecord | null>;
  invalidateReview(
    id: string,
    ownerId: string,
    invalidatedAt: string,
  ): Promise<ApplicationReviewRecord>;
  insertConfirmation(record: ApplicationConfirmationRecord): Promise<ApplicationConfirmationRecord>;
  getConfirmation(id: string, ownerId: string): Promise<ApplicationConfirmationRecord | null>;
  invalidateConfirmation(id: string, ownerId: string): Promise<ApplicationConfirmationRecord>;
  consumeConfirmation(
    id: string,
    ownerId: string,
    confirmationHash: string,
    consumedAt: string,
  ): Promise<ApplicationConfirmationRecord>;
}

export interface DelegationRepository {
  insert(record: AgentDelegationRecord): Promise<AgentDelegationRecord>;
  getById(id: string, ownerId: string): Promise<AgentDelegationRecord | null>;
  listByResource(ownerId: string, resourceId: string): Promise<AgentDelegationRecord[]>;
  getActiveMatch(input: ActiveDelegationMatchInput): Promise<AgentDelegationRecord | null>;
  approve(
    id: string,
    ownerId: string,
    approvedAt: string,
    evidence?: DelegationApprovalEvidence,
  ): Promise<AgentDelegationRecord>;
  revoke(
    id: string,
    ownerId: string,
    revokedAt: string,
    evidence?: DelegationRevocationEvidence,
  ): Promise<AgentDelegationRecord>;
}
export interface DataGrantRepository {
  insert(record: DataGrantRecord): Promise<DataGrantRecord>;
  getById(id: string, ownerId: string): Promise<DataGrantRecord | null>;
  approve(id: string, ownerId: string, approvedAt: string): Promise<DataGrantRecord>;
  withdraw(id: string, ownerId: string, withdrawnAt: string): Promise<DataGrantRecord>;
}
export interface AgentSessionRepository {
  insert(record: AgentSessionRecord): Promise<AgentSessionRecord>;
  getById(id: string, ownerId: string, draftId: string): Promise<AgentSessionRecord | null>;
  resolve(input: ResolveAgentSessionInput): Promise<AgentSessionRecord | null>;
  revoke(
    id: string,
    ownerId: string,
    draftId: string,
    revokedAt: string,
  ): Promise<AgentSessionRecord>;
}
export interface RichDataGrantRepository {
  insert(record: RichDataGrantRecord, now: string): Promise<RichDataGrantRecord>;
  getById(id: string, ownerId: string, draftId: string): Promise<RichDataGrantRecord | null>;
  listByDraft(ownerId: string, draftId: string): Promise<RichDataGrantRecord[]>;
  getCurrent(input: RichDataGrantMatchInput): Promise<RichDataGrantRecord | null>;
  approveCurrent(input: ApproveRichDataGrantInput): Promise<RichDataGrantRecord>;
  approve(id: string, ownerId: string, draftId: string, at: string): Promise<RichDataGrantRecord>;
  withdraw(
    id: string,
    ownerId: string,
    draftId: string,
    at: string,
    evidence?: GrantWithdrawalEvidence,
  ): Promise<RichDataGrantRecord>;
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

export interface OwnerActivityRepository {
  append(record: NewOwnerActivityEventRecord): Promise<OwnerActivityEventRecord>;
  clear(
    ownerId: string,
    actorKind?: OwnerActivityEventRecord["event"]["actorKind"],
  ): Promise<number>;
  listWindow(input: OwnerActivityWindowInput): Promise<OwnerActivityWindow>;
}

export interface IdempotencyRepository {
  putIfAbsent(record: IdempotencyRecord): Promise<IdempotencyPutResult>;
  get(scope: string, key: string): Promise<IdempotencyRecord | null>;
  deleteExact(input: IdempotencyRecordIdentity): Promise<boolean>;
  purgeExpired(input: {
    readonly scopePrefix: string;
    readonly now: string;
    readonly limit: number;
  }): Promise<number>;
}

export interface SearchAlertActivationRepository {
  commitApproved(input: SearchAlertActivationInput): Promise<SearchAlertActivationResult>;
}

export interface SearchAlertPreparationRepository {
  beginApproved(input: BeginApprovedSearchAlertPreparationInput): Promise<IdempotencyPutResult>;
  commitApproved(
    input: CommitApprovedSearchAlertPreparationInput,
  ): Promise<SearchAlertActivationResult>;
  decline(input: DeclineSearchAlertPreparationInput): Promise<IdempotencyPutResult>;
  expire(input: ExpireSearchAlertPreparationInput): Promise<boolean>;
  compensate(input: CompensateSearchAlertPreparationInput): Promise<boolean>;
  purgeExpired(input: PurgeExpiredSearchAlertPreparationsInput): Promise<number>;
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
  readonly identity: IdentityStore;
  readonly owners: OwnerRepository;
  readonly organizations: OrganizationRepository;
  readonly jobs: JobRepository;
  readonly savedSearches: SavedSearchRepository;
  readonly schedules: ScheduleRepository;
  readonly alerts: AlertRepository;
  readonly rateLimits: RateLimitRepository;
  readonly applications: ApplicationRepository;
  readonly delegations: DelegationRepository;
  readonly dataGrants: DataGrantRepository;
  readonly agentSessions: AgentSessionRepository;
  readonly richDataGrants: RichDataGrantRepository;
  readonly workItems: WorkItemRepository;
  readonly audit: AuditRepository;
  readonly ownerActivity: OwnerActivityRepository;
  readonly idempotency: IdempotencyRepository;
  readonly searchAlertActivation: SearchAlertActivationRepository;
  readonly searchAlertPreparation: SearchAlertPreparationRepository;
  readonly ingestion: IngestionRepository;
  close(): void;
}
