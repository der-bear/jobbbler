import type {
  AgentOperation,
  ApplicationDraft,
  DataCategory,
  Job,
  JobSearchCriteria,
  LegalBasis,
  OwnerActivityEvent,
  ScheduleRecurrence,
} from "@jobbbler/contracts";

export interface OwnerRecord {
  readonly id: string;
  readonly kind: "ephemeral" | "guest" | "user" | "service";
  readonly verified: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrganizationRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly website: string | null;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SavedSearchRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly criteria: JobSearchCriteria;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScheduleRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly savedSearchId: string;
  readonly recurrence: ScheduleRecurrence;
  readonly deliveryChannel: "email";
  readonly deliveryEndpointId: string;
  readonly enabled: boolean;
  readonly nextRunAt: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AlertBaselineItem {
  readonly jobId: string;
  readonly fingerprint: string;
}

export interface AlertEvaluationRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly savedSearchId: string;
  readonly scheduleId: string;
  readonly catalogUpdatedAt: string | null;
  readonly createdAt: string;
  readonly baseline: readonly AlertBaselineItem[];
}

export type AlertChangeKind = "new" | "updated" | "closed" | "no_longer_matching";

export interface AlertChangeRecord {
  readonly id: string;
  readonly evaluationId: string;
  readonly jobId: string;
  readonly kind: AlertChangeKind;
  readonly createdAt: string;
}

export type AlertDeliveryStatus =
  "pending" | "sending" | "accepted" | "failed" | "dead" | "cancelled";

export interface AlertDeliveryRecord {
  readonly id: string;
  readonly evaluationId: string;
  readonly ownerId: string;
  readonly scheduleId: string;
  readonly endpointId: string;
  readonly contentHash: string;
  readonly status: AlertDeliveryStatus;
  readonly attempt: number;
  readonly providerRef: string | null;
  readonly errorCode: string | null;
  readonly acceptedAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AlertDeliveryUpdate {
  readonly id: string;
  readonly status: AlertDeliveryStatus;
  readonly attempt: number;
  readonly providerRef: string | null;
  readonly errorCode: string | null;
  readonly acceptedAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly updatedAt: string;
}

export interface AlertDeliveryPutResult {
  readonly inserted: boolean;
  readonly record: AlertDeliveryRecord;
}

export interface WorkItemRecord {
  readonly id: string;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: "pending" | "running" | "succeeded" | "failed" | "dead";
  readonly availableAt: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuditEventRecord {
  readonly id: string;
  readonly type: string;
  readonly actorKind: "human" | "agent" | "system" | "service";
  readonly actorId: string | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly safeMetadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

/**
 * Redacted, presentation-only projection. The owner binding and sequence are
 * persistence concerns and are deliberately removed by the public API.
 */
export interface OwnerActivityEventRecord {
  readonly sequence: number;
  readonly ownerId: string;
  readonly event: OwnerActivityEvent;
}

export interface NewOwnerActivityEventRecord {
  readonly ownerId: string;
  readonly event: OwnerActivityEvent;
}

export interface OwnerActivityWindowInput {
  readonly ownerId: string;
  readonly afterSequence: number | null;
  readonly limit: number;
}

export interface OwnerActivityWindow {
  readonly events: readonly OwnerActivityEventRecord[];
  readonly hasMore: boolean;
  readonly latestSequence: number;
}

export interface IdempotencyRecord {
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export type IdempotencyRecordIdentity = Pick<
  IdempotencyRecord,
  "scope" | "key" | "requestHash" | "responseBody"
>;

export interface SearchAlertActivationInput {
  readonly schedule: ScheduleRecord;
  readonly expectedSavedSearchVersion: number;
  readonly verifiedEndpointId: string;
  readonly decision: IdempotencyRecord;
}

export interface SearchAlertActivationResult {
  readonly inserted: boolean;
  readonly schedule: ScheduleRecord;
  readonly decision: IdempotencyRecord;
}

export interface SearchAlertPreparationSagaBody {
  readonly version: 1;
  readonly status: "preparing";
  readonly ownerId: string;
  readonly requestId: string;
  readonly savedSearchId: string;
  readonly endpointId: string;
  readonly challengeId: string;
  readonly scheduleId: string;
  readonly issuedAt: string;
}

export interface SearchAlertPreparationSagaRecord extends IdempotencyRecord {
  readonly responseBody: SearchAlertPreparationSagaBody;
}

export interface BeginApprovedSearchAlertPreparationInput {
  readonly ownerId: string;
  readonly requestId: string;
  readonly reviewEvidenceHash: string;
  readonly intent: IdempotencyRecord;
  readonly now: string;
}

export interface CommitApprovedSearchAlertPreparationInput extends SearchAlertActivationInput {
  readonly ownerId: string;
  readonly requestId: string;
  readonly reviewEvidenceHash: string;
  readonly intent: IdempotencyRecord;
  readonly now: string;
}

export interface DeclineSearchAlertPreparationInput {
  readonly ownerId: string;
  readonly requestId: string;
  readonly reviewEvidenceHash: string;
  readonly intent: IdempotencyRecord;
  readonly decision: IdempotencyRecord;
  readonly now: string;
}

export interface ExpireSearchAlertPreparationInput {
  readonly ownerId: string;
  readonly requestId: string;
  readonly reviewEvidenceHash: string;
  readonly reviewExpiresAt: string;
  readonly now: string;
}

export interface CompensateSearchAlertPreparationInput {
  readonly saga: SearchAlertPreparationSagaRecord;
  readonly now: string;
}

export interface PurgeExpiredSearchAlertPreparationsInput {
  readonly now: string;
  readonly limit: number;
}

export interface ApplicationReviewRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly draftId: string;
  readonly draftVersion: number;
  readonly payloadHash: string;
  readonly findings: readonly string[];
  readonly status: "active" | "invalidated";
  readonly createdAt: string;
  readonly invalidatedAt: string | null;
}
export interface ApplicationConfirmationRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly draftId: string;
  readonly reviewId: string;
  readonly payloadHash: string;
  /** SHA-256 (or stronger) digest only; never the confirmation token. */ readonly confirmationHash: string;
  readonly status: "active" | "consumed" | "invalidated";
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly consumedAt: string | null;
}
export interface ApplicationReceiptRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly draftId: string;
  readonly reviewId: string;
  readonly confirmationId: string;
  readonly idempotencyKey: string;
  readonly status: "submitted" | "handed_off";
  readonly externalUrl: string | null;
  readonly createdAt: string;
}
export interface MaterialApplicationEditInput {
  readonly ownerId: string;
  readonly expectedVersion: number;
  readonly draft: ApplicationDraft;
  readonly now: string;
}
export interface SealApplicationReviewInput {
  readonly ownerId: string;
  readonly expectedVersion: number;
  readonly draft: ApplicationDraft;
  readonly review: ApplicationReviewRecord;
}
export interface SubmissionGrantScope {
  readonly id: string;
  readonly version: number;
  readonly recipientId: string;
  readonly purpose: string;
  readonly payloadHash: string;
  readonly categories: readonly DataCategory[];
  readonly fieldKeys: readonly string[];
  readonly documentIds: readonly string[];
  readonly noticeVersion: string;
  readonly legalBasis: LegalBasis;
}
export interface CompleteApplicationSubmissionInput {
  readonly ownerId: string;
  readonly draftId: string;
  readonly expectedDraftVersion: number;
  readonly reviewId: string;
  readonly reviewPayloadHash: string;
  readonly confirmationId: string;
  readonly confirmationHash: string;
  /** Decision surface whose lineage must still be valid when submission commits. */
  readonly decisionChannel: "first_party_ui" | "agent_client";
  readonly grant: SubmissionGrantScope;
  readonly receipt: ApplicationReceiptRecord;
  readonly now: string;
}
export interface CompleteApplicationSubmissionResult {
  readonly draft: ApplicationDraft;
  readonly receipt: ApplicationReceiptRecord;
  readonly inserted: boolean;
}
export interface AgentDelegationRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly agentSessionId: string;
  readonly resourceType: "application_draft";
  readonly resourceId: string;
  readonly operations: readonly AgentOperation[];
  readonly purpose: string;
  readonly status: "requested" | "active" | "revoked";
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly approvedAt: string | null;
  readonly revokedAt: string | null;
  /** Channel through which the latest explicit assistance decision was received. */
  readonly decisionChannel?: "first_party_ui" | "agent_client" | null;
  /** Exact delegation request the decision was bound to. */
  readonly decisionRequestId?: string | null;
  /** Normalized decision stored without retaining raw conversation text. */
  readonly decisionAction?: "approved" | "declined" | "revoked" | null;
  /** Versioned evidence contract used to interpret the stored decision. */
  readonly decisionEvidenceVersion?: "agent-interaction-v1" | null;
}

export interface DelegationApprovalEvidence {
  readonly channel: "first_party_ui" | "agent_client";
  readonly requestId: string;
  readonly action: "approved";
  readonly evidenceVersion: "agent-interaction-v1";
}

export interface DelegationRevocationEvidence {
  readonly channel: "first_party_ui" | "agent_client";
  readonly requestId: string;
  readonly action: "declined" | "revoked";
  readonly evidenceVersion: "agent-interaction-v1";
}
export interface DataGrantRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly recipientId: string;
  readonly purpose: string;
  readonly payloadHash: string;
  readonly fields: readonly string[];
  readonly status: "requested" | "active" | "withdrawn";
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly approvedAt: string | null;
  readonly withdrawnAt: string | null;
}
export interface AgentSessionRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly draftId: string;
  /** A one-way digest of the bearer token. Raw tokens must never enter persistence. */
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface ResolveAgentSessionInput {
  readonly tokenHash: string;
  readonly ownerId: string;
  readonly draftId: string;
  readonly now: string;
}

export interface ActiveDelegationMatchInput {
  readonly ownerId: string;
  readonly agentSessionId: string;
  readonly resourceType: "application_draft";
  readonly resourceId: string;
  readonly operation: AgentOperation;
  readonly now: string;
}

export interface RichDataGrantRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly draftId: string;
  readonly recipientId: string;
  readonly purpose: string;
  readonly payloadHash: string;
  readonly categories: readonly DataCategory[];
  readonly fieldKeys: readonly string[];
  readonly documentIds: readonly string[];
  readonly noticeVersion: string;
  readonly legalBasis: LegalBasis;
  readonly status: "requested" | "active" | "withdrawn";
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly approvedAt: string | null;
  readonly withdrawnAt: string | null;
  /** Channel through which the explicit approval action was received. */
  readonly approvalChannel?: "first_party_ui" | "agent_client" | null;
  /** Interaction request presented to the person for this approval action. */
  readonly approvalRequestId?: string | null;
  /** Normalized affirmative action stored without retaining raw conversation text. */
  readonly affirmativeAction?: "confirmed" | null;
  /** Versioned evidence contract used to interpret the stored approval fields. */
  readonly approvalEvidenceVersion?: "agent-interaction-v1" | null;
  /** Channel through which consent withdrawal was received. */
  readonly withdrawalChannel?: "first_party_ui" | "agent_client" | null;
  /** Interaction request bound to the withdrawal action. */
  readonly withdrawalRequestId?: string | null;
  /** Normalized withdrawal action stored without retaining raw conversation text. */
  readonly withdrawalAction?: "withdrawn" | null;
  /** Versioned evidence contract used to interpret the withdrawal fields. */
  readonly withdrawalEvidenceVersion?: "agent-interaction-v1" | null;
  /** Incremented for every grant state transition; absent legacy rows are version zero. */
  readonly version?: number;
}

export interface GrantApprovalEvidence {
  readonly channel: "first_party_ui" | "agent_client";
  readonly requestId: string;
  readonly affirmativeAction: "confirmed";
  readonly evidenceVersion: "agent-interaction-v1";
}

export interface GrantWithdrawalEvidence {
  readonly channel: "first_party_ui" | "agent_client";
  readonly requestId: string;
  readonly action: "withdrawn";
  readonly evidenceVersion: "agent-interaction-v1";
}

export interface RichDataGrantMatchInput {
  readonly ownerId: string;
  readonly draftId: string;
  readonly recipientId: string;
  readonly purpose: string;
  readonly payloadHash: string;
  readonly categories: readonly DataCategory[];
  readonly fieldKeys: readonly string[];
  readonly documentIds: readonly string[];
  readonly noticeVersion: string;
  readonly legalBasis: LegalBasis;
  readonly now: string;
}

export interface RichDataGrantApprovalGuard {
  readonly expectedGrantVersion: number;
  readonly expectedDraftVersion: number;
  readonly reviewId: string;
  readonly reviewPayloadHash: string;
  readonly jobId: string;
  readonly jobOrganizationId: string;
  readonly jobOrganizationName: string;
  readonly jobApplyMode: Job["applyMode"];
}

export interface ApproveRichDataGrantInput extends RichDataGrantApprovalGuard {
  readonly id: string;
  readonly ownerId: string;
  readonly draftId: string;
  readonly at: string;
  readonly approvalEvidence?: GrantApprovalEvidence;
}

export interface JobSearchQuery {
  readonly criteria: JobSearchCriteria;
  readonly now: string;
  readonly limit: number;
}

export interface JobSearchPage {
  readonly jobs: Job[];
  readonly total: number;
  readonly nextCursor: string | null;
  readonly catalogUpdatedAt: string | null;
}

export interface ClaimWorkItemsInput {
  readonly workerId: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
  readonly limit: number;
  /** When present, claim only these bounded work-item kinds. */
  readonly kinds?: readonly string[];
}

export interface RateLimitCheckInput {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly nowMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly resetAtMs: number;
}

export interface RenewWorkItemLeaseInput {
  readonly id: string;
  readonly workerId: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
}

export interface FailWorkItemInput {
  readonly id: string;
  readonly workerId: string;
  readonly now: string;
  readonly retryAt: string;
  readonly errorCode: string;
  readonly terminal: boolean;
}

export interface IdempotencyPutResult {
  readonly inserted: boolean;
  readonly record: IdempotencyRecord;
}

export interface WorkItemPutResult {
  readonly inserted: boolean;
  readonly record: WorkItemRecord;
}

export type SourceRunPurpose = "evaluation" | "production";
export type SourceRunStatus = "running" | "succeeded" | "partial" | "failed" | "skipped";
export type SourceHealth = "healthy" | "degraded" | "disabled";
export type SourceNormalizationStatus = "accepted" | "rejected" | "quarantined";

export interface SourceRunRecord {
  readonly id: string;
  readonly sourceKey: string;
  readonly partition: string;
  readonly purpose: SourceRunPurpose;
  readonly status: SourceRunStatus;
  readonly policyVersion: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly complete: boolean | null;
  readonly notModified: boolean;
  readonly pagesFetched: number;
  readonly recordsFetched: number;
  readonly recordsAccepted: number;
  readonly recordsRejected: number;
  readonly recordsUnchanged: number;
  readonly responseEtag: string | null;
  readonly responseLastModified: string | null;
  readonly responseBytes: number;
  readonly errorCode: string | null;
}

export interface SourceStateInput {
  readonly sourceKey: string;
  readonly partition: string;
  readonly health: SourceHealth;
  readonly lastAttemptAt: string | null;
  readonly lastSuccessfulAt: string | null;
  readonly nextAllowedAt: string;
  readonly consecutiveFailures: number;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly policyVersion: number;
  readonly updatedAt: string;
}

export interface SourceStateRecord extends SourceStateInput {
  readonly version: number;
}

export interface RawSourceEvidenceInput {
  readonly sourceKey: string;
  readonly partition: string;
  readonly externalId: string;
  readonly originalUrl: string;
  readonly applyUrl: string;
  readonly sourceUpdatedAt: string | null;
  readonly fetchedAt: string;
  readonly retainedUntil: string;
  readonly rawHash: string;
  readonly payload: unknown;
  readonly policyVersion: number;
  readonly attribution: {
    readonly label: string;
    readonly url: string;
    readonly required: boolean;
    readonly followedLinkRequired: boolean;
  };
}

export interface SourceNormalizationSummary {
  readonly status: SourceNormalizationStatus;
  readonly reason: string | null;
  readonly issues: readonly string[];
  readonly normalizerVersion: number;
  readonly normalizedHash: string | null;
  readonly recordedAt: string;
}

export interface StoredSourceEvidence extends RawSourceEvidenceInput {
  readonly id: string;
  readonly firstFetchedAt: string;
  readonly payload: unknown | null;
  readonly normalization: SourceNormalizationSummary | null;
}

export type PersistSourceObservationInput = {
  readonly runId: string;
  readonly evidence: RawSourceEvidenceInput;
  readonly normalization:
    | {
        readonly accepted: true;
        readonly normalizerVersion: number;
        readonly recordedAt: string;
        readonly organization: OrganizationRecord;
        readonly job: Job;
        readonly sourceLink: {
          readonly originalUrl: string;
          readonly applyUrl: string;
          readonly identityBasis: "source_id";
        };
      }
    | {
        readonly accepted: false;
        readonly status: Exclude<SourceNormalizationStatus, "accepted">;
        readonly reason: string;
        readonly issues: readonly string[];
        readonly normalizerVersion: number;
        readonly recordedAt: string;
      };
};

export interface PersistSourceObservationResult {
  readonly sourceRecordId: string;
  readonly sourceRecordInserted: boolean;
  readonly normalizationInserted: boolean;
  readonly jobVersionInserted: boolean;
}

export interface JobVersionRecord {
  readonly id: string;
  readonly jobId: string;
  readonly sourceRecordId: string;
  readonly normalizedHash: string;
  readonly job: Job;
  readonly observedAt: string;
}

export interface JobSourceLinkRecord {
  readonly jobId: string;
  readonly sourceKey: string;
  readonly partition: string;
  readonly externalId: string;
  readonly originalUrl: string;
  readonly applyUrl: string;
  readonly identityBasis: "source_id";
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly status: "active" | "possibly_closed" | "closed";
  readonly missingCompleteRuns: number;
  readonly lastCompleteRunId: string | null;
  readonly latestSourceRecordId: string;
  readonly latestSourceUpdatedAt: string;
  readonly latestRawHash: string;
  readonly attributionLabel: string;
  readonly attributionUrl: string;
  readonly attributionRequired: boolean;
  readonly followedLinkRequired: boolean;
}

export interface SourceReconciliationResult {
  readonly possiblyClosed: number;
  readonly closed: number;
}

export type { ApplicationDraft, Job };
