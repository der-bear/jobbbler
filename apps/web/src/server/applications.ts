import {
  applicationDataGrantSummarySchema,
  applicationDraftSchema,
  applicationListSchema,
  applicationReceiptSummarySchema,
  applicationReviewSummarySchema,
  applicationWorkspaceSchema,
  reviewApplicationInputSchema,
  setApplicationAnswerInputSchema,
  setApplicationAnswersInputSchema,
  startApplicationInputSchema,
  submitApplicationInputSchema,
  type ApplicationDraft,
  type ApplicationWorkspace,
  type Job,
} from "@jobbbler/contracts";
import { createEntityId, DomainError } from "@jobbbler/core-domain";
import {
  confirmReview,
  createApplicationDraft,
  reviewApplication,
  setApplicationAnswer,
  setApplicationAnswers,
  validateApplication,
  type ApplicationDraftRecord,
} from "@jobbbler/jobs-domain";
import type {
  ApplicationReviewRecord,
  RichDataGrantMatchInput,
  RichDataGrantRecord,
  Storage,
} from "@jobbbler/storage";

import { createApplicationAuthorizationRouteDependencies } from "./application-authorization";
import {
  applicationDataGrantScope,
  applicationPolicy,
  applicationPurpose,
  assertRequestedDisclosureMatches,
  hashApplicationReviewSnapshot,
  normalizeApplicationAnswer,
} from "./application-policy";
import {
  createConfirmationSecrets,
  type ApplicationActor,
  type ApplicationRouteDependencies,
} from "./application-route-handlers";
import { getServerStorage } from "./context";
import { getIdentityRouteDependencies } from "./identity";
import { createOwnerActivityPublisher } from "./owner-activity-publisher";

const answerBodySchema = setApplicationAnswerInputSchema
  .omit({ draftId: true })
  .or(setApplicationAnswersInputSchema.omit({ draftId: true }));
const reviewBodySchema = reviewApplicationInputSchema.omit({ draftId: true });
const submitBodySchema = submitApplicationInputSchema.omit({ draftId: true });
const requiredFieldKeys = applicationPolicy.requirements
  .filter(({ required }) => required)
  .map(({ fieldKey }) => fieldKey);

function notFound(name: string): DomainError {
  return new DomainError({ code: "NOT_FOUND", message: `${name} was not found.` });
}

function persistableDraft(record: ApplicationDraftRecord): ApplicationDraft {
  return applicationDraftSchema.parse({
    id: record.id,
    ownerId: record.ownerId,
    jobId: record.jobId,
    state: record.state,
    version: record.version,
    consentRevision: record.consentRevision,
    answers: record.answers,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function domainDraft(draft: ApplicationDraft): ApplicationDraftRecord {
  return { ...draft, requiredFieldKeys };
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function grantMatchesScope(
  grant: RichDataGrantRecord,
  scope: ReturnType<typeof applicationDataGrantScope>,
): boolean {
  return (
    grant.recipientId === scope.recipientId &&
    grant.purpose === scope.purpose &&
    grant.payloadHash === scope.payloadHash &&
    same(grant.categories, scope.categories) &&
    same(grant.fieldKeys, scope.fieldKeys) &&
    same(grant.documentIds, scope.documentIds) &&
    grant.noticeVersion === scope.noticeVersion &&
    grant.legalBasis === scope.legalBasis
  );
}

function grantMatchInput(
  ownerId: string,
  draft: ApplicationDraft,
  review: ApplicationReviewRecord,
  job: Job,
  now: string,
): RichDataGrantMatchInput {
  return {
    ownerId,
    draftId: draft.id,
    ...applicationDataGrantScope({ draft, review, job }),
    now,
  };
}

async function requireOwnedDraft(
  storage: Storage,
  ownerId: string,
  draftId: string,
): Promise<ApplicationDraft> {
  const draft = await storage.applications.getByOwner(draftId, ownerId);
  if (draft === null) throw notFound("Application");
  return draft;
}

async function requireJob(storage: Storage, jobId: string): Promise<Job> {
  const job = await storage.jobs.getById(jobId);
  if (job === null) throw notFound("Job");
  return job;
}

function requireSafeExternalHandoffUrl(job: Job): string {
  if (job.applyMode !== "external" || job.source.url === null) {
    throw new DomainError({
      code: "CONFLICT",
      message: "This role does not provide an external application source.",
    });
  }
  try {
    const source = new URL(job.source.url);
    if (source.protocol !== "https:" || source.username.length > 0 || source.password.length > 0) {
      throw new Error("Unsafe external source URL.");
    }
  } catch {
    throw new DomainError({
      code: "CONFLICT",
      message: "This role does not provide a safe HTTPS application source.",
    });
  }
  return job.source.url;
}

async function requireExactActiveGrant(
  storage: Storage,
  ownerId: string,
  draft: ApplicationDraft,
  review: ApplicationReviewRecord,
  job: Job,
  now: string,
): Promise<RichDataGrantRecord> {
  const match = grantMatchInput(ownerId, draft, review, job, now);
  assertRequestedDisclosureMatches({ draft, review, job, request: match });
  const grant = await storage.richDataGrants.getCurrent(match);
  if (grant === null) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "Approve the exact reviewed data disclosure before continuing.",
    });
  }
  return grant;
}

export async function buildApplicationWorkspace(
  storage: Storage,
  ownerId: string,
  draftId: string,
  now: string,
): Promise<ApplicationWorkspace> {
  const draft = await requireOwnedDraft(storage, ownerId, draftId);
  const job = await requireJob(storage, draft.jobId);
  const [review, receipt, delegations, grants] = await Promise.all([
    storage.applications.getLatestReview(draft.id, ownerId),
    storage.applications.getLatestReceipt(draft.id, ownerId),
    storage.delegations.listByResource(ownerId, draft.id),
    storage.richDataGrants.listByDraft(ownerId, draft.id),
  ]);

  let currentGrant: RichDataGrantRecord | null = null;
  if (review !== null && review.status === "active") {
    const scope = applicationDataGrantScope({ draft, review, job });
    currentGrant =
      (await storage.richDataGrants.getCurrent(
        grantMatchInput(ownerId, draft, review, job, now),
      )) ??
      grants.find(
        (grant) =>
          grant.status === "requested" && grant.expiresAt > now && grantMatchesScope(grant, scope),
      ) ??
      null;
  }

  return applicationWorkspaceSchema.parse({
    draft,
    requirements: applicationPolicy.requirements,
    recipient: { id: job.organizationId, name: job.organizationName },
    purpose: applicationPurpose(job),
    noticeVersion: applicationPolicy.noticeVersion,
    legalBasis: applicationPolicy.legalBasis,
    review:
      review === null
        ? null
        : applicationReviewSummarySchema.parse({
            id: review.id,
            draftId: review.draftId,
            draftVersion: review.draftVersion,
            payloadHash: review.payloadHash,
            status: review.status,
            createdAt: review.createdAt,
          }),
    dataGrant:
      currentGrant === null
        ? null
        : applicationDataGrantSummarySchema.parse({
            id: currentGrant.id,
            status: currentGrant.status,
            expiresAt: currentGrant.expiresAt,
          }),
    delegationRequests: delegations.slice(0, 20).map((delegation) => ({
      id: delegation.id,
      agentSessionId: delegation.agentSessionId,
      operations: delegation.operations,
      purpose: delegation.purpose,
      status: delegation.status,
      expiresAt: delegation.expiresAt,
      approvedAt: delegation.approvedAt,
    })),
    receipt:
      receipt === null
        ? null
        : applicationReceiptSummarySchema.parse({
            id: receipt.id,
            status: receipt.status,
            externalUrl: receipt.externalUrl,
            createdAt: receipt.createdAt,
          }),
  });
}

export function createApplicationRouteDependencies(
  storage: Storage,
  identity = getIdentityRouteDependencies(),
): ApplicationRouteDependencies {
  const authorization = createApplicationAuthorizationRouteDependencies(storage, identity);
  return {
    identity,
    authorization,
    confirmation: createConfirmationSecrets(),
    activity: createOwnerActivityPublisher(storage.ownerActivity),
    operations: {
      async list(ownerId) {
        const drafts = await storage.applications.listByOwner(ownerId);
        const summaries = await Promise.all(
          drafts.slice(0, 100).map(async (draft) => {
            const job = await storage.jobs.getById(draft.jobId);
            if (job === null) return null;
            return {
              draftId: draft.id,
              state: draft.state,
              updatedAt: draft.updatedAt,
              job: {
                id: job.id,
                title: job.title,
                organizationName: job.organizationName,
              },
            };
          }),
        );
        return applicationListSchema.parse(summaries.filter((summary) => summary !== null));
      },

      async start(ownerId, raw, now) {
        const { jobId } = startApplicationInputSchema.parse(raw);
        const existing = await storage.applications.getByOwnerAndJob(ownerId, jobId);
        if (existing !== null) return { draft: existing, disposition: "reopened" as const };
        const job = await requireJob(storage, jobId);
        if (job.status !== "open") {
          throw new DomainError({
            code: "CONFLICT",
            message: "This role is no longer open for applications.",
          });
        }
        if (job.applyMode === "external") {
          throw new DomainError({
            code: "CONFLICT",
            message: "This role accepts applications on the employer's website.",
          });
        }
        const draft = createApplicationDraft({
          id: createEntityId("application"),
          ownerId,
          jobId,
          requiredFieldKeys,
          now,
        });
        return {
          draft: await storage.applications.insert(persistableDraft(draft)),
          disposition: "created" as const,
        };
      },

      async get(ownerId, draftId, now) {
        return buildApplicationWorkspace(storage, ownerId, draftId, now);
      },

      async answer(actor: ApplicationActor, draftId, raw, now) {
        const input = answerBodySchema.parse(raw);
        const draft = await requireOwnedDraft(storage, actor.ownerId, draftId);
        const result =
          "answers" in input
            ? setApplicationAnswers(domainDraft(draft), {
                ownerId: actor.ownerId,
                expectedVersion: input.expectedVersion,
                answers: input.answers.map((answer) =>
                  normalizeApplicationAnswer(answer, actor.kind),
                ),
                now,
              })
            : setApplicationAnswer(domainDraft(draft), {
                ownerId: actor.ownerId,
                expectedVersion: input.expectedVersion,
                answer: normalizeApplicationAnswer(input.answer, actor.kind),
                now,
              });
        const next = persistableDraft(result.draft);
        if (next.version === draft.version) return draft;
        return storage.applications.applyMaterialEdit({
          ownerId: actor.ownerId,
          expectedVersion: draft.version,
          draft: next,
          now,
        });
      },

      async validate(actor: ApplicationActor, draftId, now) {
        const draft = await requireOwnedDraft(storage, actor.ownerId, draftId);
        const next = persistableDraft(validateApplication(domainDraft(draft), actor.ownerId, now));
        return next.version === draft.version
          ? draft
          : storage.applications.update(next, draft.version);
      },

      async review(actor: ApplicationActor, draftId, raw, now) {
        const { expectedVersion } = reviewBodySchema.parse(raw);
        const draft = await requireOwnedDraft(storage, actor.ownerId, draftId);
        const job = await requireJob(storage, draft.jobId);
        if (expectedVersion !== draft.version) {
          throw new DomainError({
            code: "CONFLICT",
            message: "Application changed after it was read.",
          });
        }
        const result = reviewApplication(domainDraft(draft), {
          id: createEntityId("review"),
          ownerId: actor.ownerId,
          now,
          hash: (canonicalDraftPayload) =>
            hashApplicationReviewSnapshot({ canonicalDraftPayload, draft, job }),
        });
        const sealed = await storage.applications.sealReview({
          ownerId: actor.ownerId,
          expectedVersion: draft.version,
          draft: persistableDraft(result.draft),
          review: { ...result.review, findings: [] },
        });
        return applicationReviewSummarySchema.parse({
          id: sealed.review.id,
          draftId: sealed.review.draftId,
          draftVersion: sealed.review.draftVersion,
          payloadHash: sealed.review.payloadHash,
          status: sealed.review.status,
          createdAt: sealed.review.createdAt,
        });
      },

      async requestConfirmation(ownerId, draftId, reviewId, confirmationHash, now) {
        const draft = await requireOwnedDraft(storage, ownerId, draftId);
        const [review, job] = await Promise.all([
          storage.applications.getReview(reviewId, ownerId),
          requireJob(storage, draft.jobId),
        ]);
        if (review === null) throw notFound("Application review");
        await requireExactActiveGrant(storage, ownerId, draft, review, job, now);
        const confirmation = confirmReview(domainDraft(draft), review, {
          id: createEntityId("confirmation"),
          ownerId,
          now,
          expiresAt: new Date(Date.parse(now) + 5 * 60_000).toISOString(),
        });
        await storage.applications.insertConfirmation({ ...confirmation, confirmationHash });
        return { id: confirmation.id, expiresAt: confirmation.expiresAt };
      },

      async submit(actor: ApplicationActor, draftId, raw, confirmationHash, now) {
        const input = submitBodySchema.parse(raw);
        const draft = await requireOwnedDraft(storage, actor.ownerId, draftId);
        const [review, job] = await Promise.all([
          storage.applications.getReview(input.reviewId, actor.ownerId),
          requireJob(storage, draft.jobId),
        ]);
        if (review === null) throw notFound("Application review");
        const externalUrl =
          job.applyMode === "external" ? requireSafeExternalHandoffUrl(job) : null;
        if (job.applyMode === "external" && actor.kind !== "human") {
          throw new DomainError({
            code: "FORBIDDEN",
            message: "An external handoff requires the human application workspace.",
          });
        }
        const grant = await requireExactActiveGrant(
          storage,
          actor.ownerId,
          draft,
          review,
          job,
          now,
        );
        const result = await storage.applications.completeSubmission({
          ownerId: actor.ownerId,
          draftId,
          expectedDraftVersion: draft.version,
          reviewId: review.id,
          reviewPayloadHash: review.payloadHash,
          confirmationId: input.confirmationId,
          confirmationHash,
          grant: {
            id: grant.id,
            version: grant.version ?? 0,
            recipientId: grant.recipientId,
            purpose: grant.purpose,
            payloadHash: grant.payloadHash,
            categories: grant.categories,
            fieldKeys: grant.fieldKeys,
            documentIds: grant.documentIds,
            noticeVersion: grant.noticeVersion,
            legalBasis: grant.legalBasis,
          },
          receipt: {
            id: createEntityId("receipt"),
            ownerId: actor.ownerId,
            draftId,
            reviewId: review.id,
            confirmationId: input.confirmationId,
            idempotencyKey: input.idempotencyKey,
            status: externalUrl === null ? "submitted" : "handed_off",
            externalUrl,
            createdAt: now,
          },
          now,
        });
        return applicationReceiptSummarySchema.parse({
          id: result.receipt.id,
          status: result.receipt.status,
          externalUrl: result.receipt.externalUrl,
          createdAt: result.receipt.createdAt,
        });
      },
    },
  };
}

const registry = globalThis as typeof globalThis & {
  __jobbblerApplicationRouteDependencies?: ApplicationRouteDependencies;
};

export function getApplicationRouteDependencies(): ApplicationRouteDependencies {
  return (
    registry.__jobbblerApplicationRouteDependencies ??
    (registry.__jobbblerApplicationRouteDependencies =
      createApplicationRouteDependencies(getServerStorage()))
  );
}
