import { afterEach, describe, expect, it } from "vitest";

import type { ApplicationDraft, Job, JobSearchCriteria } from "@jobbbler/contracts";

import type {
  AuditEventRecord,
  IdempotencyPutResult,
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

interface SearchAlertPreparationSagaBody {
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

interface SearchAlertPreparationSagaRecord extends IdempotencyRecord {
  readonly responseBody: SearchAlertPreparationSagaBody;
}

interface SearchAlertPreparationContract {
  beginApproved(input: {
    readonly ownerId: string;
    readonly requestId: string;
    readonly reviewEvidenceHash: string;
    readonly intent: IdempotencyRecord;
    readonly now: string;
  }): Promise<IdempotencyPutResult>;
  commitApproved(input: {
    readonly ownerId: string;
    readonly requestId: string;
    readonly reviewEvidenceHash: string;
    readonly intent: IdempotencyRecord;
    readonly now: string;
    readonly schedule: ScheduleRecord;
    readonly expectedSavedSearchVersion: number;
    readonly verifiedEndpointId: string;
    readonly decision: IdempotencyRecord;
  }): Promise<{
    readonly inserted: boolean;
    readonly schedule: ScheduleRecord;
    readonly decision: IdempotencyRecord;
  }>;
  decline(input: {
    readonly ownerId: string;
    readonly requestId: string;
    readonly reviewEvidenceHash: string;
    readonly intent: IdempotencyRecord;
    readonly decision: IdempotencyRecord;
    readonly now: string;
  }): Promise<IdempotencyPutResult>;
  expire(input: {
    readonly ownerId: string;
    readonly requestId: string;
    readonly reviewEvidenceHash: string;
    readonly reviewExpiresAt: string;
    readonly now: string;
  }): Promise<boolean>;
  compensate(input: {
    readonly saga: SearchAlertPreparationSagaRecord;
    readonly now: string;
  }): Promise<boolean>;
  purgeExpired(input: { readonly now: string; readonly limit: number }): Promise<number>;
}

function searchAlertPreparation(storage: Storage): SearchAlertPreparationContract {
  return (
    storage as Storage & {
      readonly searchAlertPreparation: SearchAlertPreparationContract;
    }
  ).searchAlertPreparation;
}

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
  employmentTypes: [],
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

async function searchAlertActivationFixture(current: Storage) {
  const savedSearch: SavedSearchRecord = {
    id: "search_550e8400-e29b-41d4-a716-446655449001",
    ownerId: owner.id,
    name: "Atomic alert activation",
    criteria: emptyCriteria,
    version: 3,
    createdAt: now,
    updatedAt: now,
  };
  const endpoint = {
    id: "endpoint_550e8400-e29b-41d4-a716-446655449001",
    ownerId: owner.id,
    kind: "email" as const,
    addressHash: "search-alert-activation-address-hash",
    addressCiphertext: "encrypted-search-alert-activation-address",
    maskedAddress: "a••••@example.com",
    status: "pending" as const,
    verifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const challenge = {
    id: "challenge_550e8400-e29b-41d4-a716-446655449001",
    ownerId: owner.id,
    endpointId: endpoint.id,
    purpose: "search_alert_review" as const,
    tokenHash: "search-alert-activation-code-hash",
    status: "pending" as const,
    attempts: 0,
    maxAttempts: 5,
    expiresAt: "2026-08-29T10:15:00.000Z",
    consumedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  if ((await current.owners.getById(owner.id)) === null) {
    await current.owners.insert(owner);
  }
  await current.savedSearches.insert(savedSearch);
  await current.identity.beginEmailVerification({ endpoint, challenge });
  const verification = await current.identity.consumeEmailVerification({
    ownerId: owner.id,
    challengeId: challenge.id,
    tokenHash: challenge.tokenHash,
    now,
    expectedPurpose: "search_alert_review",
    acceptConsumed: true,
  });
  if (verification.status !== "verified") {
    throw new Error("Search-alert activation fixture did not verify its delivery endpoint.");
  }

  const schedule: ScheduleRecord = {
    id: "schedule_550e8400-e29b-41d4-a716-446655449001",
    ownerId: owner.id,
    savedSearchId: savedSearch.id,
    recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
    deliveryChannel: "email",
    deliveryEndpointId: endpoint.id,
    enabled: true,
    nextRunAt: later,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
  const decision: IdempotencyRecord = {
    scope: `search_alert.decision:${owner.id}`,
    key: "request_550e8400-e29b-41d4-a716-446655449001",
    requestHash: "d".repeat(64),
    responseStatus: 201,
    responseBody: {
      version: 1,
      status: "completed",
      receipt: {
        requestId: "request_550e8400-e29b-41d4-a716-446655449001",
        decision: "approved",
        scheduleId: schedule.id,
      },
      evidence: {
        reviewBinding: "e".repeat(64),
        savedSearchId: savedSearch.id,
        savedSearchVersion: savedSearch.version,
        endpointId: endpoint.id,
      },
    },
    createdAt: now,
    expiresAt: "2027-08-29T10:00:00.000Z",
  };
  return {
    savedSearch,
    endpoint,
    schedule,
    decision,
    input: {
      schedule,
      expectedSavedSearchVersion: savedSearch.version,
      verifiedEndpointId: endpoint.id,
      decision,
    },
  };
}

export async function searchAlertPreparationFixture(
  current: Storage,
  options: {
    readonly suffix?: string;
    readonly includeEvidence?: boolean;
    readonly reuseVerifiedEndpoint?: boolean;
  } = {},
) {
  const suffix = options.suffix ?? "001";
  const issuedAt = now;
  const reviewExpiresAt = "2026-08-29T10:15:00.000Z";
  const afterReviewExpiry = "2026-08-29T10:20:00.000Z";
  const intentExpiresAt = "2026-08-29T10:30:00.000Z";
  const sagaKey = `alert-preparation-${suffix}`;
  const requestId = `request_550e8400-e29b-41d4-a716-44665545${suffix}`;
  const savedSearchId = `search_550e8400-e29b-41d4-a716-44665545${suffix}`;
  const candidateEndpointId = `endpoint_550e8400-e29b-41d4-a716-44665545${suffix}`;
  const challengeId = `challenge_550e8400-e29b-41d4-a716-44665545${suffix}`;
  const scheduleId = `schedule_550e8400-e29b-41d4-a716-44665545${suffix}`;
  const reviewEvidenceHash = suffix.padEnd(64, "e").slice(0, 64);
  const approvedDecisionHash = suffix.padEnd(64, "a").slice(0, 64);
  const declinedDecisionHash = suffix.padEnd(64, "d").slice(0, 64);
  const sagaHash = suffix.padEnd(64, "f").slice(0, 64);

  if ((await current.owners.getById(owner.id)) === null) {
    await current.owners.insert(owner);
  }
  const savedSearch: SavedSearchRecord = {
    id: savedSearchId,
    ownerId: owner.id,
    name: `Provisional search ${suffix}`,
    criteria: emptyCriteria,
    version: 0,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };
  await current.savedSearches.insert(savedSearch);

  const addressHash = `search-alert-preparation-address-${suffix}`;
  if (options.reuseVerifiedEndpoint === true) {
    const reusableEndpoint = {
      id: `endpoint_550e8400-e29b-41d4-a716-44665546${suffix}`,
      ownerId: owner.id,
      kind: "email" as const,
      addressHash,
      addressCiphertext: `encrypted-reusable-address-${suffix}`,
      maskedAddress: "r••••@example.com",
      status: "pending" as const,
      verifiedAt: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    };
    const reusableChallenge = {
      id: `challenge_550e8400-e29b-41d4-a716-44665546${suffix}`,
      ownerId: owner.id,
      endpointId: reusableEndpoint.id,
      purpose: "search_alert_review" as const,
      tokenHash: `reusable-search-alert-code-${suffix}`,
      status: "pending" as const,
      attempts: 0,
      maxAttempts: 5,
      expiresAt: reviewExpiresAt,
      consumedAt: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    };
    await current.identity.beginEmailVerification({
      endpoint: reusableEndpoint,
      challenge: reusableChallenge,
    });
    const verification = await current.identity.consumeEmailVerification({
      ownerId: owner.id,
      challengeId: reusableChallenge.id,
      tokenHash: reusableChallenge.tokenHash,
      now: issuedAt,
      expectedPurpose: "search_alert_review",
      acceptConsumed: true,
    });
    if (verification.status !== "verified") {
      throw new Error("Preparation fixture did not create its reusable verified endpoint.");
    }
  }

  const candidateEndpoint = {
    id: candidateEndpointId,
    ownerId: owner.id,
    kind: "email" as const,
    addressHash,
    addressCiphertext: `encrypted-candidate-address-${suffix}`,
    maskedAddress: "c••••@example.com",
    status: "pending" as const,
    verifiedAt: null,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };
  const candidateChallenge = {
    id: challengeId,
    ownerId: owner.id,
    endpointId: candidateEndpoint.id,
    purpose: "search_alert_review" as const,
    tokenHash: `search-alert-preparation-code-${suffix}`,
    status: "pending" as const,
    attempts: 0,
    maxAttempts: 5,
    expiresAt: reviewExpiresAt,
    consumedAt: null,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };
  const preparedVerification = await current.identity.beginEmailVerification({
    endpoint: candidateEndpoint,
    challenge: candidateChallenge,
  });
  const endpoint = preparedVerification.endpoint;
  const challenge = preparedVerification.challenge;

  const saga: SearchAlertPreparationSagaRecord = {
    scope: `search_alert.request_saga:${owner.id}`,
    key: sagaKey,
    requestHash: sagaHash,
    responseStatus: 202,
    responseBody: {
      version: 1,
      status: "preparing",
      ownerId: owner.id,
      requestId,
      savedSearchId,
      endpointId: candidateEndpointId,
      challengeId,
      scheduleId,
      issuedAt,
    },
    createdAt: issuedAt,
    expiresAt: reviewExpiresAt,
  };
  const requestClaim: IdempotencyRecord = {
    scope: `search_alert.request_claim:${owner.id}`,
    key: sagaKey,
    requestHash: sagaHash,
    responseStatus: 202,
    responseBody: { version: 1, status: "claimed", requestId },
    createdAt: issuedAt,
    expiresAt: reviewExpiresAt,
  };
  const requestResult: IdempotencyRecord = {
    scope: `search_alert.request_result:${owner.id}`,
    key: sagaKey,
    requestHash: sagaHash,
    responseStatus: 200,
    responseBody: { version: 1, status: "review_required", requestId },
    createdAt: issuedAt,
    expiresAt: reviewExpiresAt,
  };
  const requestEvidence: IdempotencyRecord = {
    scope: `search_alert.request:${owner.id}`,
    key: requestId,
    requestHash: reviewEvidenceHash,
    responseStatus: 200,
    responseBody: {
      version: 1,
      purpose: "search_alert_activation",
      ownerId: owner.id,
      requestId,
      savedSearchId,
      savedSearchVersion: 0,
      criteria: emptyCriteria,
      endpointId: endpoint.id,
      challengeId,
      scheduleId,
      recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
      firstRunAt: "2026-08-30T09:00:00.000Z",
      privacyNoticeVersion: "2026-08-29",
      issuedAt,
      expiresAt: reviewExpiresAt,
    },
    createdAt: issuedAt,
    expiresAt: reviewExpiresAt,
  };
  const decisionClaim: IdempotencyRecord = {
    scope: `search_alert.decision_claim:${owner.id}`,
    key: requestId,
    requestHash: reviewEvidenceHash,
    responseStatus: 202,
    responseBody: { version: 1, status: "claimed", requestId },
    createdAt: issuedAt,
    expiresAt: intentExpiresAt,
  };
  for (const record of [saga, requestClaim, requestResult, decisionClaim]) {
    await current.idempotency.putIfAbsent(record);
  }
  if (options.includeEvidence !== false) {
    await current.idempotency.putIfAbsent(requestEvidence);
  }

  const approvedIntent: IdempotencyRecord = {
    scope: `search_alert.decision_intent:${owner.id}`,
    key: requestId,
    requestHash: approvedDecisionHash,
    responseStatus: 202,
    responseBody: {
      version: 1,
      status: "deciding",
      requestId,
      decision: "approved",
      reviewBinding: approvedDecisionHash,
      recordedAt: issuedAt,
    },
    createdAt: issuedAt,
    expiresAt: intentExpiresAt,
  };
  const declinedIntent: IdempotencyRecord = {
    ...approvedIntent,
    requestHash: declinedDecisionHash,
    responseBody: {
      ...(approvedIntent.responseBody as Record<string, unknown>),
      decision: "declined",
      reviewBinding: declinedDecisionHash,
    },
  };
  const schedule: ScheduleRecord = {
    id: scheduleId,
    ownerId: owner.id,
    savedSearchId,
    recurrence: { frequency: "daily", time: "09:00", timeZone: "UTC" },
    deliveryChannel: "email",
    deliveryEndpointId: endpoint.id,
    enabled: true,
    nextRunAt: "2026-08-30T09:00:00.000Z",
    version: 0,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };
  const approvedDecision: IdempotencyRecord = {
    scope: `search_alert.decision:${owner.id}`,
    key: requestId,
    requestHash: approvedDecisionHash,
    responseStatus: 201,
    responseBody: {
      version: 1,
      status: "completed",
      receipt: {
        status: "completed",
        requestId,
        decision: "approved",
        channel: "agent_client",
        savedSearchId,
        scheduleId,
        nextRunAt: schedule.nextRunAt,
        decidedAt: issuedAt,
        summary: "Job alert activated for the reviewed search and destination.",
      },
      evidence: {
        reviewBinding: approvedDecisionHash,
        purpose: "Activate the reviewed job alert.",
        dataCategories: ["saved_search_criteria", "delivery_email"],
        retention: "Until the alert is deleted.",
        withdrawal: "Disable or delete the alert.",
        criteria: emptyCriteria,
        savedSearchId,
        savedSearchVersion: 0,
        endpointId: endpoint.id,
        recurrence: schedule.recurrence,
        firstRunAt: schedule.nextRunAt,
        privacyNoticeVersion: "2026-08-29",
        channel: "agent_client",
        decidedAt: issuedAt,
      },
    },
    createdAt: issuedAt,
    expiresAt: "2027-08-29T10:00:00.000Z",
  };
  const declinedDecision: IdempotencyRecord = {
    ...approvedDecision,
    requestHash: declinedDecisionHash,
    responseStatus: 200,
    responseBody: {
      version: 1,
      status: "completed",
      receipt: {
        status: "completed",
        requestId,
        decision: "declined",
        channel: "agent_client",
        savedSearchId,
        scheduleId: null,
        nextRunAt: null,
        decidedAt: issuedAt,
        summary: "Job alert activation declined. No schedule was created.",
      },
      evidence: {
        reviewBinding: declinedDecisionHash,
        purpose: "Activate the reviewed job alert.",
        dataCategories: ["saved_search_criteria", "delivery_email"],
        retention: "Until the alert is deleted.",
        withdrawal: "Disable or delete the alert.",
        criteria: emptyCriteria,
        savedSearchId,
        savedSearchVersion: 0,
        endpointId: endpoint.id,
        recurrence: schedule.recurrence,
        firstRunAt: schedule.nextRunAt,
        privacyNoticeVersion: "2026-08-29",
        channel: "agent_client",
        decidedAt: issuedAt,
      },
    },
  };

  return {
    owner,
    issuedAt,
    reviewExpiresAt,
    afterReviewExpiry,
    intentExpiresAt,
    reviewEvidenceHash,
    approvedDecisionHash,
    declinedDecisionHash,
    savedSearch,
    endpoint,
    challenge,
    saga,
    requestClaim,
    requestResult,
    requestEvidence,
    decisionClaim,
    approvedIntent,
    declinedIntent,
    schedule,
    approvedDecision,
    declinedDecision,
    beginApprovedInput: {
      ownerId: owner.id,
      requestId,
      reviewEvidenceHash,
      intent: approvedIntent,
      now: issuedAt,
    },
    commitApprovedInput: {
      ownerId: owner.id,
      requestId,
      reviewEvidenceHash,
      intent: approvedIntent,
      now: issuedAt,
      schedule,
      expectedSavedSearchVersion: 0,
      verifiedEndpointId: endpoint.id,
      decision: approvedDecision,
    },
    declineInput: {
      ownerId: owner.id,
      requestId,
      reviewEvidenceHash,
      intent: declinedIntent,
      decision: declinedDecision,
      now: issuedAt,
    },
    expireInput: {
      ownerId: owner.id,
      requestId,
      reviewEvidenceHash,
      reviewExpiresAt,
      now: afterReviewExpiry,
    },
  };
}

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
      await current.jobs.upsert({
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440010",
        summary: "Build reliable engineering systems without the second search term.",
      });

      expect(await current.jobs.getById(job.id)).toEqual(job);
      expect(
        await current.jobs.search({
          criteria: { ...emptyCriteria, query: "TypeScript workflow" },
          now,
          limit: 10,
        }),
      ).toEqual({ jobs: [job], total: 1, nextCursor: null, catalogUpdatedAt: now });
    });

    it("orders title matches ahead of body-only matches for best-match search", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const titleMatch = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440020",
        title: "Security Engineer",
        summary: "Build dependable systems for technology teams.",
      };
      const bodyMatch = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440021",
        title: "Chief Technology Officer",
        summary: "Lead engineering, operations, and security across the company.",
      };
      await current.jobs.upsert(bodyMatch);
      await current.jobs.upsert(titleMatch);

      await expect(
        current.jobs.search({
          criteria: { ...emptyCriteria, query: "security", sort: "relevance" },
          now,
          limit: 10,
        }),
      ).resolves.toMatchObject({ jobs: [titleMatch, bodyMatch], total: 2 });
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
      await expect(current.jobs.suggestLocations("germ", 8)).resolves.toEqual(["Berlin, Germany"]);
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

    it("filters by employment type before returning or ranking jobs", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const contractJob = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440017",
        employmentType: "contract" as const,
      };
      await current.jobs.upsert(job);
      await current.jobs.upsert(contractJob);

      await expect(
        current.jobs.search({
          criteria: { ...emptyCriteria, employmentTypes: ["contract"] },
          now,
          limit: 10,
        }),
      ).resolves.toMatchObject({ jobs: [contractJob], total: 1, nextCursor: null });
    });

    it("searches category text from the canonical job document", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const categorized = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440016",
        title: "Research Specialist",
        summary: "Build explainable workflows for technical teams.",
        categories: ["data_ai" as const],
        skills: ["Python"],
      };
      await current.jobs.upsert(categorized);

      await expect(
        current.jobs.search({
          criteria: { ...emptyCriteria, query: "data" },
          now,
          limit: 10,
        }),
      ).resolves.toEqual({
        jobs: [categorized],
        total: 1,
        nextCursor: null,
        catalogUpdatedAt: now,
      });
    });

    it("matches location filters after removing diacritics", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const malaga = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440017",
        locations: ["Málaga, Spain"],
      };
      await current.jobs.upsert(malaga);

      await expect(
        current.jobs.search({
          criteria: { ...emptyCriteria, locations: ["Malaga"] },
          now,
          limit: 10,
        }),
      ).resolves.toEqual({
        jobs: [malaga],
        total: 1,
        nextCursor: null,
        catalogUpdatedAt: now,
      });
    });

    it("uses diacritic-normalized skills as soft relevance evidence", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const malaga = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440018",
        skills: ["Málaga"],
      };
      await current.jobs.upsert(job);
      await current.jobs.upsert(malaga);

      const result = await current.jobs.search({
        criteria: { ...emptyCriteria, skills: ["Malaga"], sort: "relevance" },
        now,
        limit: 10,
      });
      expect(result.jobs.map(({ id }) => id)).toEqual([malaga.id, job.id]);
      expect(result.total).toBe(2);
    });

    it("applies exclusions after removing diacritics", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      await current.jobs.upsert({
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440019",
        summary: "Build a platform with the Málaga engineering group.",
      });

      await expect(
        current.jobs.search({
          criteria: { ...emptyCriteria, excludeKeywords: ["Malaga"] },
          now,
          limit: 10,
        }),
      ).resolves.toEqual({ jobs: [], total: 0, nextCursor: null, catalogUpdatedAt: null });
    });

    it("keeps requested skills as a soft relevance dimension across adapters", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const rust = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440013",
        skills: ["Rust"],
      };
      await current.jobs.upsert(job);
      await current.jobs.upsert(rust);

      const first = await current.jobs.search({
        criteria: { ...emptyCriteria, skills: ["Rust"], sort: "relevance", limit: 1 },
        now,
        limit: 1,
      });

      expect(first.jobs.map(({ id }) => id)).toEqual([rust.id]);
      expect(first.total).toBe(2);
      expect(first.nextCursor).toEqual(expect.any(String));
      await expect(
        current.jobs.search({
          criteria: {
            ...emptyCriteria,
            skills: ["Rust"],
            sort: "relevance",
            cursor: first.nextCursor,
            limit: 1,
          },
          now,
          limit: 1,
        }),
      ).resolves.toEqual({
        jobs: [job],
        total: 2,
        nextCursor: null,
        catalogUpdatedAt: now,
      });
    });

    it("rounds exact half-point relevance scores like Math.round", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const requestedSkills = Array.from({ length: 16 }, (_, index) => `skill-${index + 1}`);
      const halfPoint = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440024",
        locations: ["Europe", "Germany", "Berlin"],
        skills: requestedSkills.slice(0, 6),
        publishedAt: "2026-08-27T09:00:00.000Z",
      };
      const belowHalf = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440025",
        locations: ["Europe"],
        skills: requestedSkills.slice(0, 13),
        publishedAt: "2026-08-28T09:00:00.000Z",
      };
      await current.jobs.upsert(halfPoint);
      await current.jobs.upsert(belowHalf);

      const result = await current.jobs.search({
        criteria: {
          ...emptyCriteria,
          locations: ["Europe", "Germany", "Berlin"],
          skills: requestedSkills,
          sort: "relevance",
        },
        now,
        limit: 10,
      });
      expect(result.jobs.map(({ id }) => id)).toEqual([halfPoint.id, belowHalf.id]);
    });

    it("keeps salary ordering and unknown-salary policies aligned across adapters", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const lowerSalary = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440014",
        salary: { minimum: 80_000, maximum: 90_000, currency: "EUR", period: "year" } as const,
      };
      const unknownSalary = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440015",
        salary: null,
      };
      await current.jobs.upsert(job);
      await current.jobs.upsert(lowerSalary);
      await current.jobs.upsert(unknownSalary);

      await expect(
        current.jobs.search({
          criteria: { ...emptyCriteria, sort: "salary_desc" },
          now,
          limit: 10,
        }),
      ).resolves.toMatchObject({ jobs: [job, lowerSalary, unknownSalary], total: 3 });
      await expect(
        current.jobs.search({
          criteria: { ...emptyCriteria, sort: "salary_asc" },
          now,
          limit: 10,
        }),
      ).resolves.toMatchObject({ jobs: [lowerSalary, job, unknownSalary], total: 3 });

      const salary = {
        minimum: 120_000,
        maximum: null,
        currency: "EUR",
        period: "year" as const,
        unknownPolicy: "include" as const,
      };
      await expect(
        current.jobs.search({
          criteria: { ...emptyCriteria, salary, sort: "relevance" },
          now,
          limit: 10,
        }),
      ).resolves.toMatchObject({ jobs: [job, unknownSalary], total: 2 });
      await expect(
        current.jobs.search({
          criteria: {
            ...emptyCriteria,
            salary: { ...salary, unknownPolicy: "exclude" },
            sort: "relevance",
          },
          now,
          limit: 10,
        }),
      ).resolves.toMatchObject({ jobs: [job], total: 1 });
      await expect(
        current.jobs.search({
          criteria: {
            ...emptyCriteria,
            salary: {
              minimum: null,
              maximum: null,
              currency: null,
              period: "year",
              unknownPolicy: "only",
            },
            sort: "relevance",
          },
          now,
          limit: 10,
        }),
      ).resolves.toMatchObject({ jobs: [unknownSalary], total: 1 });
    });

    it("sorts by the most recently updated role with stable publication and id tie-breakers", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const recentlyUpdated = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440018",
        publishedAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-30T10:00:00.000Z",
      };
      await current.jobs.upsert(job);
      await current.jobs.upsert(recentlyUpdated);

      await expect(
        current.jobs.search({
          criteria: { ...emptyCriteria, sort: "updated_desc" },
          now: "2026-08-30T12:00:00.000Z",
          limit: 10,
        }),
      ).resolves.toMatchObject({ jobs: [recentlyUpdated, job], total: 2 });
    });

    it("sorts salaries by comparable annual EUR value across paginated results", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const hourlySalary = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440036",
        salary: { minimum: 60, maximum: 70, currency: "EUR", period: "hour" } as const,
      };
      const usdSalary = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440037",
        salary: { minimum: 140_000, maximum: 160_000, currency: "USD", period: "year" } as const,
      };
      const cadSalary = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440038",
        salary: { minimum: 180_000, maximum: 210_000, currency: "CAD", period: "year" } as const,
      };
      const eurSalary = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440039",
        salary: { minimum: 110_000, maximum: 130_000, currency: "EUR", period: "year" } as const,
      };
      const unknownSalary = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440040",
        salary: null,
      };
      for (const candidate of [hourlySalary, usdSalary, cadSalary, eurSalary, unknownSalary]) {
        await current.jobs.upsert(candidate);
      }

      const firstPage = await current.jobs.search({
        criteria: { ...emptyCriteria, sort: "salary_desc", limit: 2 },
        now,
        limit: 2,
      });
      expect(firstPage).toMatchObject({ jobs: [hourlySalary, usdSalary], total: 5 });
      expect(firstPage.nextCursor).not.toBeNull();

      const secondPage = await current.jobs.search({
        criteria: {
          ...emptyCriteria,
          sort: "salary_desc",
          cursor: firstPage.nextCursor,
          limit: 2,
        },
        now,
        limit: 2,
      });
      expect(secondPage).toMatchObject({ jobs: [cadSalary, eurSalary], total: 5 });
      expect(secondPage.nextCursor).not.toBeNull();

      await expect(
        current.jobs.search({
          criteria: {
            ...emptyCriteria,
            sort: "salary_desc",
            cursor: secondPage.nextCursor,
            limit: 2,
          },
          now,
          limit: 2,
        }),
      ).resolves.toMatchObject({ jobs: [unknownSalary], total: 5, nextCursor: null });
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
      expect(firstPage.nextCursor?.length).toBeLessThanOrEqual(256);

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

    it("orders equivalent instants by id across a newest cursor", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const first = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440020",
        publishedAt: "2026-08-29T00:00:00.123456789Z",
      };
      const second = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440021",
        publishedAt: "2026-08-29T10:00:00.123456789+10:00",
      };
      await current.jobs.upsert(first);
      await current.jobs.upsert(second);

      const firstPage = await current.jobs.search({
        criteria: { ...emptyCriteria, sort: "newest", limit: 1 },
        now,
        limit: 1,
      });
      expect(firstPage.jobs).toEqual([first]);
      expect(firstPage.nextCursor).toEqual(expect.any(String));
      await expect(
        current.jobs.search({
          criteria: {
            ...emptyCriteria,
            sort: "newest",
            cursor: firstPage.nextCursor,
            limit: 1,
          },
          now,
          limit: 1,
        }),
      ).resolves.toEqual({
        jobs: [second],
        total: 2,
        nextCursor: null,
        catalogUpdatedAt: now,
      });
    });

    it("keeps a long-timestamp cursor inside the public bound", async () => {
      const current = await create();
      await current.organizations.upsert(organization);
      const first = {
        ...job,
        id: `${"j".repeat(31)}_550e8400-e29b-41d4-a716-446655440022`,
        publishedAt: "2026-08-29T11:00:00.123456789012345678901234567890Z",
      };
      const second = {
        ...job,
        id: "job_550e8400-e29b-41d4-a716-446655440023",
        publishedAt: "2026-08-29T10:00:00.000Z",
      };
      await current.jobs.upsert(first);
      await current.jobs.upsert(second);

      const firstPage = await current.jobs.search({
        criteria: { ...emptyCriteria, sort: "salary_desc", limit: 1 },
        now,
        limit: 1,
      });
      expect(firstPage.jobs).toEqual([first]);
      expect(firstPage.nextCursor?.length).toBeLessThanOrEqual(256);
      await expect(
        current.jobs.search({
          criteria: {
            ...emptyCriteria,
            sort: "salary_desc",
            cursor: firstPage.nextCursor,
            limit: 1,
          },
          now,
          limit: 1,
        }),
      ).resolves.toMatchObject({ jobs: [second], total: 2, nextCursor: null });
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

    it("atomically commits an approved search-alert schedule and exact decision receipt", async () => {
      const current = await create();
      const fixture = await searchAlertActivationFixture(current);

      await expect(current.searchAlertActivation.commitApproved(fixture.input)).resolves.toEqual({
        inserted: true,
        schedule: fixture.schedule,
        decision: fixture.decision,
      });
      await expect(current.searchAlertActivation.commitApproved(fixture.input)).resolves.toEqual({
        inserted: false,
        schedule: fixture.schedule,
        decision: fixture.decision,
      });
      await expect(current.schedules.getById(fixture.schedule.id)).resolves.toEqual(
        fixture.schedule,
      );
      await expect(
        current.idempotency.get(fixture.decision.scope, fixture.decision.key),
      ).resolves.toEqual(fixture.decision);
    });

    it("recovers an identical pre-existing search-alert schedule by committing its receipt", async () => {
      const current = await create();
      const fixture = await searchAlertActivationFixture(current);
      await current.schedules.insert(fixture.schedule);

      await expect(current.searchAlertActivation.commitApproved(fixture.input)).resolves.toEqual({
        inserted: true,
        schedule: fixture.schedule,
        decision: fixture.decision,
      });
      await expect(
        current.idempotency.get(fixture.decision.scope, fixture.decision.key),
      ).resolves.toEqual(fixture.decision);
    });

    it("replays an exact committed activation after a later saved-search change", async () => {
      const current = await create();
      const fixture = await searchAlertActivationFixture(current);
      await current.searchAlertActivation.commitApproved(fixture.input);
      await current.savedSearches.update(
        { ...fixture.savedSearch, name: "Changed after activation", updatedAt: later },
        fixture.savedSearch.version,
      );

      await expect(current.searchAlertActivation.commitApproved(fixture.input)).resolves.toEqual({
        inserted: false,
        schedule: fixture.schedule,
        decision: fixture.decision,
      });
    });

    it("rejects a different schedule for a committed search-alert decision", async () => {
      const current = await create();
      const fixture = await searchAlertActivationFixture(current);
      await current.searchAlertActivation.commitApproved(fixture.input);

      await expect(
        current.searchAlertActivation.commitApproved({
          ...fixture.input,
          schedule: {
            ...fixture.schedule,
            nextRunAt: "2026-08-30T10:05:00.000Z",
          },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("rejects a different decision receipt for a committed search-alert schedule", async () => {
      const current = await create();
      const fixture = await searchAlertActivationFixture(current);
      await current.searchAlertActivation.commitApproved(fixture.input);

      await expect(
        current.searchAlertActivation.commitApproved({
          ...fixture.input,
          decision: {
            ...fixture.decision,
            responseBody: {
              ...(fixture.decision.responseBody as Record<string, unknown>),
              status: "different",
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("rejects search-alert activation after the reviewed saved-search version changes", async () => {
      const current = await create();
      const fixture = await searchAlertActivationFixture(current);
      await current.savedSearches.update(
        { ...fixture.savedSearch, name: "Changed after review", updatedAt: later },
        fixture.savedSearch.version,
      );

      await expect(
        current.searchAlertActivation.commitApproved(fixture.input),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(current.schedules.getById(fixture.schedule.id)).resolves.toBeNull();
      await expect(
        current.idempotency.get(fixture.decision.scope, fixture.decision.key),
      ).resolves.toBeNull();
    });

    it("rejects search-alert activation after the reviewed endpoint is revoked", async () => {
      const current = await create();
      const fixture = await searchAlertActivationFixture(current);
      await current.identity.revokeVerificationEndpoint(owner.id, fixture.endpoint.id, later);

      await expect(
        current.searchAlertActivation.commitApproved(fixture.input),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(current.schedules.getById(fixture.schedule.id)).resolves.toBeNull();
      await expect(
        current.idempotency.get(fixture.decision.scope, fixture.decision.key),
      ).resolves.toBeNull();
    });

    it("rejects a new search-alert challenge for a revoked shared endpoint", async () => {
      const current = await create();
      await current.owners.insert(owner);
      const endpoint = {
        id: "endpoint_550e8400-e29b-41d4-a716-446655441100",
        ownerId: owner.id,
        kind: "email" as const,
        addressHash: "revoked-search-alert-address",
        addressCiphertext: "encrypted-revoked-search-alert-address",
        maskedAddress: "r••••••@example.com",
        status: "pending" as const,
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const challenge = {
        id: "challenge_550e8400-e29b-41d4-a716-446655441101",
        ownerId: owner.id,
        endpointId: endpoint.id,
        purpose: "search_alert_review" as const,
        tokenHash: "revoked-search-alert-token-a",
        status: "pending" as const,
        attempts: 0,
        maxAttempts: 5,
        expiresAt: "2026-08-29T10:15:00.000Z",
        consumedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await current.identity.beginEmailVerification({ endpoint, challenge });
      await current.identity.revokeVerificationEndpoint(owner.id, endpoint.id, later);
      const replacementChallengeId = "challenge_550e8400-e29b-41d4-a716-446655441102";

      await expect(
        current.identity.beginEmailVerification({
          endpoint: {
            ...endpoint,
            id: "endpoint_550e8400-e29b-41d4-a716-446655441103",
            addressCiphertext: "replacement-encrypted-address",
            createdAt: later,
            updatedAt: later,
          },
          challenge: {
            ...challenge,
            id: replacementChallengeId,
            endpointId: "endpoint_550e8400-e29b-41d4-a716-446655441103",
            tokenHash: "revoked-search-alert-token-b",
            createdAt: later,
            updatedAt: later,
          },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        current.identity.getVerificationEndpoint(owner.id, endpoint.id),
      ).resolves.toMatchObject({ status: "revoked" });
      await expect(
        current.identity.abandonEmailVerification({
          ownerId: owner.id,
          challengeId: replacementChallengeId,
          expectedPurpose: "search_alert_review",
          now: later,
        }),
      ).resolves.toBe(false);
    });

    it("rolls back a search-alert schedule when the decision receipt cannot be inserted", async () => {
      const current = await create();
      const fixture = await searchAlertActivationFixture(current);
      const circularReceipt: Record<string, unknown> = {};
      circularReceipt["self"] = circularReceipt;

      await expect(
        current.searchAlertActivation.commitApproved({
          ...fixture.input,
          decision: { ...fixture.decision, responseBody: circularReceipt },
        }),
      ).rejects.toThrow();
      await expect(current.schedules.getById(fixture.schedule.id)).resolves.toBeNull();
      await expect(
        current.idempotency.get(fixture.decision.scope, fixture.decision.key),
      ).resolves.toBeNull();
    });

    it("records only an exact approved search-alert intent against a live saga and review", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);
      const repository = searchAlertPreparation(current);

      await expect(repository.beginApproved(fixture.beginApprovedInput)).resolves.toEqual({
        inserted: true,
        record: fixture.approvedIntent,
      });
      await expect(repository.beginApproved(fixture.beginApprovedInput)).resolves.toEqual({
        inserted: false,
        record: fixture.approvedIntent,
      });
      await expect(
        repository.beginApproved({
          ...fixture.beginApprovedInput,
          intent: {
            ...fixture.approvedIntent,
            responseBody: {
              ...(fixture.approvedIntent.responseBody as Record<string, unknown>),
              status: "different",
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("rejects approved search-alert intent creation after the saga or review expires", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);

      await expect(
        searchAlertPreparation(current).beginApproved({
          ...fixture.beginApprovedInput,
          now: fixture.afterReviewExpiry,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        current.idempotency.get(fixture.approvedIntent.scope, fixture.approvedIntent.key),
      ).resolves.toBeNull();
    });

    it("rejects and does not protect an approved intent retained beyond 24 hours", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);
      const overRetainedIntent: IdempotencyRecord = {
        ...fixture.approvedIntent,
        expiresAt: "2026-08-30T10:00:00.001Z",
      };
      const repository = searchAlertPreparation(current);

      await expect(
        repository.beginApproved({
          ...fixture.beginApprovedInput,
          intent: overRetainedIntent,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await current.idempotency.putIfAbsent(overRetainedIntent);
      await expect(repository.expire(fixture.expireInput)).resolves.toBe(true);
      await expect(
        current.idempotency.get(fixture.saga.scope, fixture.saga.key),
      ).resolves.toBeNull();
      await expect(
        current.idempotency.get(overRetainedIntent.scope, overRetainedIntent.key),
      ).resolves.toBeNull();
    });

    it("atomically declines and cleans exact provisional search-alert state", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current, {
        reuseVerifiedEndpoint: true,
      });

      await expect(searchAlertPreparation(current).decline(fixture.declineInput)).resolves.toEqual({
        inserted: true,
        record: fixture.declinedDecision,
      });

      await expect(current.savedSearches.getById(fixture.savedSearch.id)).resolves.toBeNull();
      await expect(
        current.idempotency.get(fixture.saga.scope, fixture.saga.key),
      ).resolves.toBeNull();
      for (const record of [
        fixture.requestClaim,
        fixture.requestResult,
        fixture.requestEvidence,
        fixture.decisionClaim,
        fixture.declinedIntent,
      ]) {
        await expect(current.idempotency.get(record.scope, record.key)).resolves.toBeNull();
      }
      await expect(
        current.idempotency.get(fixture.declinedDecision.scope, fixture.declinedDecision.key),
      ).resolves.toEqual(fixture.declinedDecision);
      await expect(
        current.identity.getVerificationEndpoint(owner.id, fixture.endpoint.id),
      ).resolves.toMatchObject({ id: fixture.endpoint.id, status: "verified" });
      await expect(
        current.identity.abandonEmailVerification({
          ownerId: owner.id,
          challengeId: fixture.challenge.id,
          expectedPurpose: "search_alert_review",
          now: fixture.afterReviewExpiry,
        }),
      ).resolves.toBe(false);
    });

    it("commits approved activation and preparation cleanup in one transaction", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);
      const verification = await current.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: fixture.challenge.id,
        tokenHash: fixture.challenge.tokenHash,
        now: fixture.issuedAt,
        expectedPurpose: "search_alert_review",
        acceptConsumed: true,
      });
      expect(verification.status).toBe("verified");
      const repository = searchAlertPreparation(current);
      await repository.beginApproved(fixture.beginApprovedInput);

      await expect(repository.commitApproved(fixture.commitApprovedInput)).resolves.toEqual({
        inserted: true,
        schedule: fixture.schedule,
        decision: fixture.approvedDecision,
      });
      await expect(current.schedules.getById(fixture.schedule.id)).resolves.toEqual(
        fixture.schedule,
      );
      await expect(
        current.idempotency.get(fixture.approvedDecision.scope, fixture.approvedDecision.key),
      ).resolves.toEqual(fixture.approvedDecision);
      await expect(
        current.idempotency.get(fixture.saga.scope, fixture.saga.key),
      ).resolves.toBeNull();
      await expect(
        current.idempotency.get(fixture.approvedIntent.scope, fixture.approvedIntent.key),
      ).resolves.toBeNull();
      await expect(current.savedSearches.getById(fixture.savedSearch.id)).resolves.toEqual(
        fixture.savedSearch,
      );
    });

    it("rolls back approval when its consent evidence drifts from the reviewed schedule", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);
      const verification = await current.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: fixture.challenge.id,
        tokenHash: fixture.challenge.tokenHash,
        now: fixture.issuedAt,
        expectedPurpose: "search_alert_review",
        acceptConsumed: true,
      });
      expect(verification.status).toBe("verified");
      const repository = searchAlertPreparation(current);
      await repository.beginApproved(fixture.beginApprovedInput);
      const envelope = fixture.approvedDecision.responseBody as {
        readonly version: 1;
        readonly status: "completed";
        readonly receipt: Readonly<Record<string, unknown>>;
        readonly evidence: Readonly<Record<string, unknown>>;
      };

      await expect(
        repository.commitApproved({
          ...fixture.commitApprovedInput,
          decision: {
            ...fixture.approvedDecision,
            responseBody: {
              ...envelope,
              evidence: {
                ...envelope.evidence,
                firstRunAt: "2026-08-30T10:00:00.000Z",
              },
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(current.schedules.getById(fixture.schedule.id)).resolves.toBeNull();
      await expect(
        current.idempotency.get(fixture.approvedDecision.scope, fixture.approvedDecision.key),
      ).resolves.toBeNull();
      await expect(current.idempotency.get(fixture.saga.scope, fixture.saga.key)).resolves.toEqual(
        fixture.saga,
      );
      await expect(
        current.idempotency.get(fixture.approvedIntent.scope, fixture.approvedIntent.key),
      ).resolves.toEqual(fixture.approvedIntent);
    });

    it("rejects activation when its approved intent has expired", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);
      const expiringIntent: IdempotencyRecord = {
        ...fixture.approvedIntent,
        expiresAt: "2026-08-29T10:10:00.000Z",
      };
      const repository = searchAlertPreparation(current);
      await repository.beginApproved({ ...fixture.beginApprovedInput, intent: expiringIntent });

      await expect(
        repository.commitApproved({
          ...fixture.commitApprovedInput,
          intent: expiringIntent,
          now: fixture.afterReviewExpiry,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(current.schedules.getById(fixture.schedule.id)).resolves.toBeNull();
      await expect(
        current.idempotency.get(fixture.approvedDecision.scope, fixture.approvedDecision.key),
      ).resolves.toBeNull();
      await expect(current.idempotency.get(fixture.saga.scope, fixture.saga.key)).resolves.toEqual(
        fixture.saga,
      );
    });

    it("expires an authenticated review even after its request evidence is gone", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current, { includeEvidence: false });
      const repository = searchAlertPreparation(current);

      await expect(
        repository.expire({ ...fixture.expireInput, now: fixture.issuedAt }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(repository.expire(fixture.expireInput)).resolves.toBe(true);
      await expect(current.savedSearches.getById(fixture.savedSearch.id)).resolves.toBeNull();
      await expect(
        current.idempotency.get(fixture.saga.scope, fixture.saga.key),
      ).resolves.toBeNull();
    });

    it("compensates only the exact search-alert preparation saga", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);
      const repository = searchAlertPreparation(current);

      await expect(
        repository.compensate({
          saga: { ...fixture.saga, requestHash: "x".repeat(64) },
          now: fixture.issuedAt,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        repository.compensate({ saga: fixture.saga, now: fixture.issuedAt }),
      ).resolves.toBe(true);
      await expect(
        repository.compensate({ saga: fixture.saga, now: fixture.issuedAt }),
      ).resolves.toBe(false);
    });

    it("preserves an adopted or activated saved search during lifecycle cleanup", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);
      const adopted = await current.savedSearches.update(
        { ...fixture.savedSearch, name: "Adopted search", updatedAt: later },
        0,
      );
      await current.schedules.insert(fixture.schedule);

      await expect(searchAlertPreparation(current).expire(fixture.expireInput)).resolves.toBe(true);
      await expect(current.savedSearches.getById(fixture.savedSearch.id)).resolves.toEqual(adopted);
      await expect(current.schedules.getById(fixture.schedule.id)).resolves.toEqual(
        fixture.schedule,
      );
    });

    it("preserves a revoked delivery endpoint during lifecycle cleanup", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);
      await current.identity.revokeVerificationEndpoint(owner.id, fixture.endpoint.id, later);

      await expect(searchAlertPreparation(current).expire(fixture.expireInput)).resolves.toBe(true);
      await expect(
        current.identity.getVerificationEndpoint(owner.id, fixture.endpoint.id),
      ).resolves.toMatchObject({ id: fixture.endpoint.id, status: "revoked" });
      await expect(current.savedSearches.getById(fixture.savedSearch.id)).resolves.toBeNull();
    });

    it("protects live approved intent and committed approval from expiry cleanup", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);
      const repository = searchAlertPreparation(current);
      await repository.beginApproved(fixture.beginApprovedInput);

      await expect(repository.expire(fixture.expireInput)).resolves.toBe(false);
      await expect(
        repository.compensate({ saga: fixture.saga, now: fixture.afterReviewExpiry }),
      ).resolves.toBe(false);
      await expect(
        repository.purgeExpired({ now: fixture.afterReviewExpiry, limit: 10 }),
      ).resolves.toBe(0);
      await expect(current.idempotency.get(fixture.saga.scope, fixture.saga.key)).resolves.toEqual(
        fixture.saga,
      );

      await expect(
        repository.purgeExpired({ now: "2026-08-29T10:31:00.000Z", limit: 10 }),
      ).resolves.toBe(1);
      await expect(
        current.idempotency.get(fixture.saga.scope, fixture.saga.key),
      ).resolves.toBeNull();
    });

    it("does not expire a saga after its exact approval was durably committed", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);
      const verification = await current.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: fixture.challenge.id,
        tokenHash: fixture.challenge.tokenHash,
        now: fixture.issuedAt,
        expectedPurpose: "search_alert_review",
        acceptConsumed: true,
      });
      expect(verification.status).toBe("verified");
      await current.searchAlertActivation.commitApproved({
        schedule: fixture.schedule,
        expectedSavedSearchVersion: 0,
        verifiedEndpointId: fixture.endpoint.id,
        decision: fixture.approvedDecision,
      });

      await expect(searchAlertPreparation(current).expire(fixture.expireInput)).resolves.toBe(
        false,
      );
      await expect(current.idempotency.get(fixture.saga.scope, fixture.saga.key)).resolves.toEqual(
        fixture.saga,
      );
      await expect(current.savedSearches.getById(fixture.savedSearch.id)).resolves.toEqual(
        fixture.savedSearch,
      );
    });

    it("purges expired preparation sagas in bounded lifecycle transactions", async () => {
      const current = await create();
      const first = await searchAlertPreparationFixture(current, { suffix: "011" });
      const second = await searchAlertPreparationFixture(current, { suffix: "012" });
      const repository = searchAlertPreparation(current);

      await expect(
        repository.purgeExpired({ now: first.afterReviewExpiry, limit: 1 }),
      ).resolves.toBe(1);
      const remainingAfterFirst = await Promise.all([
        current.idempotency.get(first.saga.scope, first.saga.key),
        current.idempotency.get(second.saga.scope, second.saga.key),
      ]);
      expect(remainingAfterFirst.filter((record) => record !== null)).toHaveLength(1);
      await expect(
        repository.purgeExpired({ now: first.afterReviewExpiry, limit: 1 }),
      ).resolves.toBe(1);
      await expect(current.idempotency.get(first.saga.scope, first.saga.key)).resolves.toBeNull();
      await expect(current.idempotency.get(second.saga.scope, second.saga.key)).resolves.toBeNull();
    });

    it("does not let a protected approved intent consume the bounded purge slot", async () => {
      const current = await create();
      const protectedFirst = await searchAlertPreparationFixture(current, { suffix: "013" });
      const unattendedSecond = await searchAlertPreparationFixture(current, { suffix: "014" });
      const repository = searchAlertPreparation(current);
      await repository.beginApproved(protectedFirst.beginApprovedInput);

      await expect(
        repository.purgeExpired({ now: protectedFirst.afterReviewExpiry, limit: 1 }),
      ).resolves.toBe(1);
      await expect(
        current.idempotency.get(protectedFirst.saga.scope, protectedFirst.saga.key),
      ).resolves.toEqual(protectedFirst.saga);
      await expect(
        current.idempotency.get(unattendedSecond.saga.scope, unattendedSecond.saga.key),
      ).resolves.toBeNull();
    });

    it("does not let a committed approval consume the bounded purge slot", async () => {
      const current = await create();
      const committedFirst = await searchAlertPreparationFixture(current, { suffix: "015" });
      const unattendedSecond = await searchAlertPreparationFixture(current, { suffix: "016" });
      const verification = await current.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: committedFirst.challenge.id,
        tokenHash: committedFirst.challenge.tokenHash,
        now: committedFirst.issuedAt,
        expectedPurpose: "search_alert_review",
        acceptConsumed: true,
      });
      expect(verification.status).toBe("verified");
      await current.searchAlertActivation.commitApproved({
        schedule: committedFirst.schedule,
        expectedSavedSearchVersion: 0,
        verifiedEndpointId: committedFirst.endpoint.id,
        decision: committedFirst.approvedDecision,
      });

      await expect(
        searchAlertPreparation(current).purgeExpired({
          now: committedFirst.afterReviewExpiry,
          limit: 1,
        }),
      ).resolves.toBe(1);
      await expect(
        current.idempotency.get(committedFirst.saga.scope, committedFirst.saga.key),
      ).resolves.toEqual(committedFirst.saga);
      await expect(
        current.idempotency.get(unattendedSecond.saga.scope, unattendedSecond.saga.key),
      ).resolves.toBeNull();
    });

    it("rolls back decline persistence when its durable decision cannot be serialized", async () => {
      const current = await create();
      const fixture = await searchAlertPreparationFixture(current);
      const circularBody: Record<string, unknown> = {};
      circularBody["self"] = circularBody;

      await expect(
        searchAlertPreparation(current).decline({
          ...fixture.declineInput,
          decision: { ...fixture.declinedDecision, responseBody: circularBody },
        }),
      ).rejects.toThrow();
      await expect(current.idempotency.get(fixture.saga.scope, fixture.saga.key)).resolves.toEqual(
        fixture.saga,
      );
      await expect(current.savedSearches.getById(fixture.savedSearch.id)).resolves.toEqual(
        fixture.savedSearch,
      );
      await expect(
        current.idempotency.get(fixture.declinedIntent.scope, fixture.declinedIntent.key),
      ).resolves.toBeNull();
      await expect(
        current.idempotency.get(fixture.declinedDecision.scope, fixture.declinedDecision.key),
      ).resolves.toBeNull();
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

    it("purges only a bounded expired idempotency scope family", async () => {
      const current = await create();
      const base: IdempotencyRecord = {
        scope: "search_alert.request_claim:owner-1",
        key: "expired-a",
        requestHash: "a".repeat(64),
        responseStatus: 202,
        responseBody: { status: "preparing", claimId: "claim-a" },
        createdAt: now,
        expiresAt: "2026-08-29T10:01:00.000Z",
      };
      await current.idempotency.putIfAbsent(base);
      await current.idempotency.putIfAbsent({ ...base, key: "expired-b" });
      await current.idempotency.putIfAbsent({
        ...base,
        scope: "application.submit:owner-1",
        key: "unrelated",
      });
      await current.idempotency.putIfAbsent({
        ...base,
        key: "fresh",
        expiresAt: "2026-08-29T10:10:00.000Z",
      });
      const lifecycleOwned = [
        "search_alert.request_saga:owner-1",
        "search_alert.request:owner-1",
        "search_alert.request_result:owner-1",
        "search_alert.decision_intent:owner-1",
      ].map((scope, index) => ({
        ...base,
        scope,
        key: `lifecycle-${index}`,
      }));
      for (const record of lifecycleOwned) {
        await current.idempotency.putIfAbsent(record);
      }

      await expect(
        current.idempotency.purgeExpired({
          scopePrefix: "search_alert.",
          now: later,
          limit: 1,
        }),
      ).resolves.toBe(1);
      await expect(
        current.idempotency.purgeExpired({
          scopePrefix: "search_alert.",
          now: later,
          limit: 10,
        }),
      ).resolves.toBe(1);
      await expect(current.idempotency.get(base.scope, "expired-a")).resolves.toBeNull();
      await expect(current.idempotency.get(base.scope, "expired-b")).resolves.toBeNull();
      await expect(
        current.idempotency.get("application.submit:owner-1", "unrelated"),
      ).resolves.not.toBeNull();
      await expect(current.idempotency.get(base.scope, "fresh")).resolves.not.toBeNull();
      for (const record of lifecycleOwned) {
        await expect(current.idempotency.get(record.scope, record.key)).resolves.toEqual(record);
      }
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
      expect(await current.ownerActivity.clear(owner.id)).toBe(2);
      expect(
        await current.ownerActivity.listWindow({
          ownerId: owner.id,
          afterSequence: null,
          limit: 10,
        }),
      ).toEqual({ events: [], hasMore: false, latestSequence: 0 });
      expect(
        await current.ownerActivity.listWindow({
          ownerId: otherOwner.id,
          afterSequence: null,
          limit: 10,
        }),
      ).toEqual({ events: [other], hasMore: false, latestSequence: other.sequence });
      expect(await current.ownerActivity.clear(owner.id)).toBe(0);
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

    it("filters and clears agent activity without touching human activity", async () => {
      const current = await create();
      await current.owners.insert(owner);
      const agent = await current.ownerActivity.append({
        ownerId: owner.id,
        event: {
          id: "activity_650e8400-e29b-41d4-a716-446655440000",
          schemaVersion: 1,
          kind: "tool",
          key: "prepare_application",
          status: "completed",
          safeSummary: "Application prepared.",
          correlationId: "corr_650e8400-e29b-41d4-a716-446655440000",
          actorKind: "agent",
          aggregate: { type: "application_draft", version: 1 },
          occurredAt: now,
          effects: [{ target: "application", kind: "refresh" }],
        },
      });
      const human = await current.ownerActivity.append({
        ownerId: owner.id,
        event: {
          ...agent.event,
          id: "activity_750e8400-e29b-41d4-a716-446655440000",
          key: "submit_application",
          safeSummary: "Application submitted.",
          correlationId: "corr_750e8400-e29b-41d4-a716-446655440000",
          actorKind: "human",
          aggregate: { type: "application_draft", version: 2 },
          occurredAt: later,
        },
      });

      expect(
        await current.ownerActivity.listWindow({
          ownerId: owner.id,
          afterSequence: null,
          limit: 10,
          actorKind: "agent",
        }),
      ).toEqual({ events: [agent], hasMore: false, latestSequence: agent.sequence });
      expect(await current.ownerActivity.clear(owner.id, "agent")).toBe(1);
      expect(
        await current.ownerActivity.listWindow({
          ownerId: owner.id,
          afterSequence: null,
          limit: 10,
        }),
      ).toEqual({ events: [human], hasMore: false, latestSequence: human.sequence });
    });
  });
}
