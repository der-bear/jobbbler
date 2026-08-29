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

export interface IdempotencyPutResult {
  readonly inserted: boolean;
  readonly record: IdempotencyRecord;
}

export type { ApplicationDraft, Job };
