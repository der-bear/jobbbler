import type { Job, RequestDataGrant } from "@jobbbler/contracts";
import { DomainError } from "@jobbbler/core-domain";
import type {
  ApplicationRepository,
  JobRepository,
  RichDataGrantApprovalGuard,
  RichDataGrantRecord,
  Storage,
} from "@jobbbler/storage";

import {
  createAgentSessionTokenSecrets,
  createApplicationAuthorizationIds,
  type ApplicationDataGrantAuthorizationPolicy,
  type ApplicationAuthorizationRouteDependencies,
} from "./application-authorization-route-handlers";
import {
  applicationConsentPresentation,
  assertRequestedDisclosureMatches,
} from "./application-policy";
import { getServerStorage } from "./context";
import { createIdentityRouteDependencies, getIdentityRouteDependencies } from "./identity";
import type { IdentityRouteDependencies } from "./identity-route-handlers";
import { createOwnerActivityPublisher } from "./owner-activity-publisher";

export interface ApplicationDataGrantPolicyRepositories {
  readonly applications: Pick<ApplicationRepository, "getByOwner" | "getLatestReview">;
  readonly jobs: Pick<JobRepository, "getById">;
}

function currentDisclosureUnavailable(): DomainError {
  return new DomainError({
    code: "CONFLICT",
    message: "The current reviewed disclosure is not available.",
  });
}

function assertInternalApplicationJob(job: Job): void {
  if (job.applyMode === "external") {
    throw new DomainError({
      code: "CONFLICT",
      message: "This role accepts applications on the employer's website.",
    });
  }
}

export function createApplicationDataGrantAuthorizationPolicy(
  repositories: ApplicationDataGrantPolicyRepositories,
): ApplicationDataGrantAuthorizationPolicy {
  const assertRequest = async (
    input: Readonly<{
      ownerId: string;
      draftId: string;
      request: Omit<RequestDataGrant, "draftId">;
    }>,
  ) => {
    const draft = await repositories.applications.getByOwner(input.draftId, input.ownerId);
    if (draft === null) throw currentDisclosureUnavailable();
    const [review, job] = await Promise.all([
      repositories.applications.getLatestReview(input.draftId, input.ownerId),
      repositories.jobs.getById(draft.jobId),
    ]);
    if (review === null || job === null) throw currentDisclosureUnavailable();
    assertInternalApplicationJob(job);
    assertRequestedDisclosureMatches({ draft, review, job, request: input.request });
    return { draft, review, job };
  };

  return {
    consentPresentation: async (ownerId, draftId) => {
      const draft = await repositories.applications.getByOwner(draftId, ownerId);
      if (draft === null) throw currentDisclosureUnavailable();
      const job = await repositories.jobs.getById(draft.jobId);
      if (job === null) throw currentDisclosureUnavailable();
      assertInternalApplicationJob(job);
      return applicationConsentPresentation(draft, job);
    },
    assertDataGrantRequest: async (input) => {
      await assertRequest(input);
    },
    assertStoredDataGrantCurrent: async (
      record: RichDataGrantRecord,
    ): Promise<RichDataGrantApprovalGuard> => {
      const { draft, review, job } = await assertRequest({
        ownerId: record.ownerId,
        draftId: record.draftId,
        request: {
          recipientId: record.recipientId,
          purpose: record.purpose,
          payloadHash: record.payloadHash,
          categories: [...record.categories],
          fieldKeys: [...record.fieldKeys],
          documentIds: [...record.documentIds],
          noticeVersion: record.noticeVersion,
          legalBasis: record.legalBasis,
        },
      });
      return {
        expectedGrantVersion: record.version ?? 0,
        expectedDraftVersion: draft.version,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        jobId: job.id,
        jobOrganizationId: job.organizationId,
        jobOrganizationName: job.organizationName,
        jobApplyMode: job.applyMode,
      };
    },
  };
}

export function createApplicationAuthorizationRouteDependencies(
  storage: Storage,
  identity: IdentityRouteDependencies = createIdentityRouteDependencies(storage),
): ApplicationAuthorizationRouteDependencies {
  return {
    identity,
    applications: storage.applications,
    jobs: storage.jobs,
    agentSessions: storage.agentSessions,
    delegations: storage.delegations,
    richDataGrants: storage.richDataGrants,
    idempotency: storage.idempotency,
    dataGrantPolicy: createApplicationDataGrantAuthorizationPolicy(storage),
    ids: createApplicationAuthorizationIds(),
    agentTokens: createAgentSessionTokenSecrets(),
    activity: createOwnerActivityPublisher(storage.ownerActivity),
  };
}

const globalRegistry = globalThis as typeof globalThis & {
  __jobbblerApplicationAuthorizationDependencies?: ApplicationAuthorizationRouteDependencies;
};

export function getApplicationAuthorizationRouteDependencies(): ApplicationAuthorizationRouteDependencies {
  const existing = globalRegistry.__jobbblerApplicationAuthorizationDependencies;
  if (existing !== undefined) return existing;
  const dependencies = createApplicationAuthorizationRouteDependencies(
    getServerStorage(),
    getIdentityRouteDependencies(),
  );
  globalRegistry.__jobbblerApplicationAuthorizationDependencies = dependencies;
  return dependencies;
}
