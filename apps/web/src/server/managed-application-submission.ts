import type { ApplicationDraft, Job } from "@jobbbler/contracts";
import { createEntityId, DomainError } from "@jobbbler/core-domain";
import type { ManagedApplicationDeliveryRecord } from "@jobbbler/storage";

import { applicationConsentPresentation, applicationReviewPayloadHash } from "./application-policy";

type ManagedSubmissionIdPrefix = "managed_delivery" | "demo_submission";
type ManagedSubmissionIdFactory = (prefix: ManagedSubmissionIdPrefix) => string;

export interface ManagedApplicationSubmissionAdapter {
  prepare(
    input: Readonly<{
      ownerId: string;
      draft: ApplicationDraft;
      job: Job;
      reviewId: string;
      reviewPayloadHash: string;
      confirmationId: string;
      idempotencyKey: string;
      now: string;
    }>,
  ): ManagedApplicationDeliveryRecord;
}

export function createManagedDemoApplicationSubmissionAdapter(
  createId: ManagedSubmissionIdFactory = (prefix) => createEntityId(prefix),
): ManagedApplicationSubmissionAdapter {
  return {
    prepare(input) {
      if (
        input.draft.ownerId !== input.ownerId ||
        input.draft.jobId !== input.job.id ||
        input.draft.state !== "reviewed" ||
        input.job.applyMode !== "internal" ||
        input.job.source.key !== "jobbbler_demo" ||
        input.job.source.url !== null
      ) {
        throw new DomainError({
          code: "CONFLICT",
          message: "Managed delivery is available only for a current first-party demo application.",
        });
      }
      if (input.reviewPayloadHash !== applicationReviewPayloadHash(input.draft, input.job)) {
        throw new DomainError({
          code: "CONFLICT",
          message:
            "The current field presentation no longer matches the exact reviewed field presentation.",
        });
      }
      const presentation = applicationConsentPresentation(input.draft, input.job);
      return {
        id: createId("managed_delivery"),
        ownerId: input.ownerId,
        draftId: input.draft.id,
        reviewId: input.reviewId,
        confirmationId: input.confirmationId,
        idempotencyKey: input.idempotencyKey,
        provider: "jobbbler_demo",
        providerReferenceId: createId("demo_submission"),
        role: { id: input.job.id, title: input.job.title },
        recipientId: presentation.recipientId,
        recipientName: presentation.recipientName,
        payloadHash: input.reviewPayloadHash,
        fields: presentation.fields,
        status: "acknowledged",
        acknowledgedAt: input.now,
        createdAt: input.now,
      };
    },
  };
}
