import type {
  ApplicationDraft,
  Job,
  JobSearchCriteria,
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

export interface IdempotencyRecord {
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface JobSearchQuery {
  readonly criteria: JobSearchCriteria;
  readonly now: string;
  readonly limit: number;
}

export interface JobSearchPage {
  readonly jobs: Job[];
  readonly nextCursor: string | null;
}

export interface ClaimWorkItemsInput {
  readonly workerId: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
  readonly limit: number;
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
