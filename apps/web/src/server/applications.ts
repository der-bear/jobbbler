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
  type ApplicationReceiptSummary,
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
  ApplicationReceiptRecord,
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
  normalizeLegacyApplicationDraft,
} from "./application-policy";
import {
  createConfirmationSecrets,
  type ApplicationActor,
  type ApplicationRouteDependencies,
} from "./application-route-handlers";
import { getServerStorage } from "./context";
import { getIdentityRouteDependencies } from "./identity";
import { createManagedDemoApplicationSubmissionAdapter } from "./managed-application-submission";
import { createOwnerActivityPublisher } from "./owner-activity-publisher";

const answerBodySchema = setApplicationAnswerInputSchema
  .omit({ draftId: true })
  .or(setApplicationAnswersInputSchema.omit({ draftId: true }));
const reviewBodySchema = reviewApplicationInputSchema.omit({ draftId: true });
const submitBodySchema = submitApplicationInputSchema.omit({ draftId: true });
const requiredFieldKeys = applicationPolicy.requirements
  .filter(({ required }) => required)
  .map(({ fieldKey }) => fieldKey);
const reusableFieldKeys = applicationPolicy.requirements
  .filter(({ fieldKey }) => fieldKey !== "cover_letter")
  .map(({ fieldKey }) => fieldKey);

/**
 * Carries the person's own reusable answers into a new application so a second
 * application asks only for what is specific to that role. Values stay inside the
 * owner's workspace: every disclosure still needs the review and its decision.
 */
function carriedOverAnswers(
  previous: readonly ApplicationDraft[],
): readonly ApplicationDraft["answers"][number][] {
  const carried = new Map<string, ApplicationDraft["answers"][number]>();
  for (const draft of previous) {
    for (const answer of draft.answers) {
      if (!reusableFieldKeys.includes(answer.fieldKey) || carried.has(answer.fieldKey)) continue;
      carried.set(answer.fieldKey, { ...answer, acceptedByHuman: false });
    }
  }
  return [...carried.values()];
}
const managedApplicationSubmission = createManagedDemoApplicationSubmissionAdapter();

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

function persistedReceiptSummary(
  receipt: ApplicationReceiptRecord,
): ApplicationReceiptSummary | null {
  if (receipt.status === "handed_off") {
    return applicationReceiptSummarySchema.parse({
      id: receipt.id,
      status: receipt.status,
      externalUrl: receipt.externalUrl,
      createdAt: receipt.createdAt,
    });
  }
  if (receipt.submission == null) return null;
  return applicationReceiptSummarySchema.parse({
    id: receipt.id,
    status: receipt.status,
    externalUrl: receipt.externalUrl,
    createdAt: receipt.createdAt,
    submission: {
      provider: receipt.submission.provider,
      providerReferenceId: receipt.submission.providerReferenceId,
      role: receipt.submission.role,
      recipient: {
        id: receipt.submission.recipientId,
        name: receipt.submission.recipientName,
      },
      submittedAt: receipt.submission.submittedAt,
      fields: receipt.submission.fields.map(({ fieldKey, label, value }) => ({
        fieldKey,
        label,
        value,
      })),
    },
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
  return normalizeLegacyApplicationDraft(draft);
}

async function requireJob(storage: Storage, jobId: string): Promise<Job> {
  const job = await storage.jobs.getById(jobId);
  if (job === null) throw notFound("Job");
  return job;
}

function assertInternalApplicationJob(job: Job): void {
  if (job.applyMode === "external") {
    throw new DomainError({
      code: "CONFLICT",
      message: "This role accepts applications on the employer's website.",
    });
  }
}

function assertOpenApplicationJob(job: Job): void {
  if (job.status !== "open") {
    throw new DomainError({
      code: "CONFLICT",
      message: "Role closed — nothing submitted.",
    });
  }
}

async function requireOwnedInternalDraftAtAnyStatus(
  storage: Storage,
  ownerId: string,
  draftId: string,
): Promise<Readonly<{ draft: ApplicationDraft; job: Job }>> {
  const draft = await requireOwnedDraft(storage, ownerId, draftId);
  const job = await requireJob(storage, draft.jobId);
  assertInternalApplicationJob(job);
  return { draft, job };
}

async function requireOwnedInternalDraft(
  storage: Storage,
  ownerId: string,
  draftId: string,
): Promise<Readonly<{ draft: ApplicationDraft; job: Job }>> {
  const { draft, job } = await requireOwnedInternalDraftAtAnyStatus(storage, ownerId, draftId);
  assertOpenApplicationJob(job);
  return { draft, job };
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

/*
 * Fills a still-untouched application with the answers this person already gave
 * on another one, so a second application asks only for what belongs to that
 * role. It runs on the first read of an empty draft — where both the page and
 * the agent look before anyone is asked anything.
 *
 * Guarded to an untouched draft at version 0: nothing can be under review yet,
 * so this cannot move a frozen payload out from under a pending decision. The
 * values stay inside the person's own workspace; disclosing them to an employer
 * still needs the review and its decision.
 */
async function hydrateReusableAnswers(
  storage: Storage,
  draft: ApplicationDraft,
  now: string,
): Promise<ApplicationDraft> {
  if (draft.version !== 0 || draft.answers.length > 0) return draft;
  const previous = await storage.applications.listByOwner(draft.ownerId);
  const answers = carriedOverAnswers(previous.filter((other) => other.id !== draft.id));
  if (answers.length === 0) return draft;
  try {
    return await storage.applications.update(
      { ...draft, answers: [...answers], updatedAt: now },
      draft.version,
    );
  } catch {
    /*
     * The page and the agent often read one fresh application at the same
     * moment. Whoever loses that race reads back the draft the winner just
     * filled instead of failing on a version that moved underneath it.
     */
    return requireOwnedDraft(storage, draft.ownerId, draft.id);
  }
}

export async function buildApplicationWorkspace(
  storage: Storage,
  ownerId: string,
  draftId: string,
  now: string,
): Promise<ApplicationWorkspace> {
  const draft = await hydrateReusableAnswers(
    storage,
    await requireOwnedDraft(storage, ownerId, draftId),
    now,
  );
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
    serverNow: now,
    applyMode: job.applyMode,
    draft,
    job,
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
            decisionChannel:
              currentGrant.approvalChannel ??
              (currentGrant.approvalRequestId === null ||
              currentGrant.approvalRequestId === undefined
                ? "first_party_ui"
                : "agent_client"),
            decisionRequestId: currentGrant.approvalRequestId ?? currentGrant.id,
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
    receipt: receipt === null ? null : persistedReceiptSummary(receipt),
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
                status: job.status,
              },
            };
          }),
        );
        return applicationListSchema.parse(summaries.filter((summary) => summary !== null));
      },

      async discard(ownerId, draftId) {
        const removed = await storage.applications.discardOwned(draftId, ownerId);
        if (!removed) throw notFound("Application draft");
      },

      async start(ownerId, raw, now) {
        const { jobId } = startApplicationInputSchema.parse(raw);
        const job = await requireJob(storage, jobId);
        assertInternalApplicationJob(job);
        assertOpenApplicationJob(job);
        const existing = await storage.applications.getByOwnerAndJob(ownerId, jobId);
        if (existing !== null) {
          return {
            draft: normalizeLegacyApplicationDraft(existing),
            disposition: "reopened" as const,
          };
        }
        const draft = createApplicationDraft({
          id: createEntityId("application"),
          ownerId,
          jobId,
          requiredFieldKeys,
          now,
        });
        const answers = carriedOverAnswers(await storage.applications.listByOwner(ownerId));
        return {
          draft: await storage.applications.insert(persistableDraft({ ...draft, answers })),
          disposition: "created" as const,
        };
      },

      async get(ownerId, draftId, now) {
        return buildApplicationWorkspace(storage, ownerId, draftId, now);
      },

      async answer(actor: ApplicationActor, draftId, raw, now) {
        const input = answerBodySchema.parse(raw);
        const { draft } = await requireOwnedInternalDraft(storage, actor.ownerId, draftId);
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
        const { draft } = await requireOwnedInternalDraft(storage, actor.ownerId, draftId);
        const next = persistableDraft(validateApplication(domainDraft(draft), actor.ownerId, now));
        return next.version === draft.version
          ? draft
          : storage.applications.update(next, draft.version);
      },

      async review(actor: ApplicationActor, draftId, raw, now) {
        const { expectedVersion } = reviewBodySchema.parse(raw);
        const { draft, job } = await requireOwnedInternalDraft(storage, actor.ownerId, draftId);
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
        const { draft, job } = await requireOwnedInternalDraft(storage, ownerId, draftId);
        const review = await storage.applications.getReview(reviewId, ownerId);
        if (review === null) throw notFound("Application review");
        await requireExactActiveGrant(storage, ownerId, draft, review, job, now);
        const confirmation = confirmReview(domainDraft(draft), review, {
          id: createEntityId("confirmation"),
          ownerId,
          now,
          expiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
        });
        await storage.applications.insertConfirmation({ ...confirmation, confirmationHash });
        return { id: confirmation.id, expiresAt: confirmation.expiresAt };
      },

      async submit(actor: ApplicationActor, draftId, raw, confirmationHash, now) {
        const input = submitBodySchema.parse(raw);
        const { draft, job } = await requireOwnedInternalDraftAtAnyStatus(
          storage,
          actor.ownerId,
          draftId,
        );
        if (draft.state === "submitted") {
          const existing = await storage.applications.getLatestReceipt(draftId, actor.ownerId);
          if (
            existing?.status !== "submitted" ||
            existing.reviewId !== input.reviewId ||
            existing.confirmationId !== input.confirmationId ||
            existing.idempotencyKey !== input.idempotencyKey ||
            existing.submission == null
          ) {
            throw new DomainError({
              code: "CONFLICT",
              message: "This application was already submitted by another request.",
            });
          }
          const delivery = await storage.applications.getManagedDelivery(
            existing.submission.managedDeliveryId,
            actor.ownerId,
          );
          if (
            delivery?.status !== "acknowledged" ||
            delivery.providerReferenceId !== existing.submission.providerReferenceId ||
            delivery.role?.id !== job.id ||
            delivery.role?.title !== job.title ||
            existing.submission.role?.id !== delivery.role.id ||
            existing.submission.role?.title !== delivery.role.title
          ) {
            throw new DomainError({
              code: "CONFLICT",
              message: "The persisted submission is missing its delivery acknowledgement.",
            });
          }
          const summary = persistedReceiptSummary(existing);
          if (summary === null) {
            throw new DomainError({
              code: "CONFLICT",
              message: "The persisted submission is missing its delivery acknowledgement.",
            });
          }
          return summary;
        }
        assertOpenApplicationJob(job);
        const review = await storage.applications.getReview(input.reviewId, actor.ownerId);
        if (review === null) throw notFound("Application review");
        const grant = await requireExactActiveGrant(
          storage,
          actor.ownerId,
          draft,
          review,
          job,
          now,
        );
        const delivery = managedApplicationSubmission.prepare({
          ownerId: actor.ownerId,
          draft,
          job,
          reviewId: review.id,
          reviewPayloadHash: review.payloadHash,
          confirmationId: input.confirmationId,
          idempotencyKey: input.idempotencyKey,
          now,
        });
        const result = await storage.applications.completeSubmission({
          ownerId: actor.ownerId,
          draftId,
          expectedDraftVersion: draft.version,
          reviewId: review.id,
          reviewPayloadHash: review.payloadHash,
          confirmationId: input.confirmationId,
          confirmationHash,
          decisionChannel: actor.kind === "agent" ? "agent_client" : "first_party_ui",
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
          delivery,
          receipt: {
            id: createEntityId("receipt"),
            ownerId: actor.ownerId,
            draftId,
            reviewId: review.id,
            confirmationId: input.confirmationId,
            idempotencyKey: input.idempotencyKey,
            status: "submitted",
            externalUrl: null,
            submission: {
              managedDeliveryId: delivery.id,
              provider: delivery.provider,
              providerReferenceId: delivery.providerReferenceId,
              role: delivery.role,
              recipientId: delivery.recipientId,
              recipientName: delivery.recipientName,
              submittedAt: delivery.acknowledgedAt,
              fields: delivery.fields,
            },
            createdAt: now,
          },
          now,
        });
        const summary = persistedReceiptSummary(result.receipt);
        if (summary === null) {
          throw new DomainError({
            code: "CONFLICT",
            message: "Submission completed without a persisted receipt snapshot.",
          });
        }
        return summary;
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
