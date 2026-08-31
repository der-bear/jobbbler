import { describe, expect, it } from "vitest";

import type { ApplicationDraft, Job } from "@jobbbler/contracts";

import { applicationReviewPayloadHash } from "./application-policy";
import { createManagedDemoApplicationSubmissionAdapter } from "./managed-application-submission";

const now = "2026-08-29T10:00:00.000Z";

describe("managed demo application submission adapter", () => {
  it("seals the exact reviewed label/value pairs into one acknowledged delivery", () => {
    const ids = {
      managed_delivery: "managed_delivery_550e8400-e29b-41d4-a716-446655440000",
      demo_submission: "demo_submission_550e8400-e29b-41d4-a716-446655440000",
    } as const;
    const adapter = createManagedDemoApplicationSubmissionAdapter((prefix) => ids[prefix]);
    const draft = {
      id: "application_550e8400-e29b-41d4-a716-446655440000",
      ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
      jobId: "job_550e8400-e29b-41d4-a716-446655440000",
      state: "reviewed",
      version: 2,
      answers: [
        {
          fieldKey: "full_name",
          value: "Ada Lovelace",
          provenance: "user_entered",
          sensitive: true,
          acceptedByHuman: true,
        },
        {
          fieldKey: "email",
          value: "ada@example.test",
          provenance: "user_entered",
          sensitive: true,
          acceptedByHuman: true,
        },
        {
          fieldKey: "location",
          value: "London, United Kingdom",
          provenance: "user_entered",
          sensitive: true,
          acceptedByHuman: true,
        },
        {
          fieldKey: "cover_letter",
          value: "Build useful systems.",
          provenance: "user_entered",
          sensitive: true,
          acceptedByHuman: true,
        },
        {
          fieldKey: "work_authorization",
          value: "Authorized to work in the European Union",
          provenance: "user_entered",
          sensitive: true,
          acceptedByHuman: true,
        },
      ],
      createdAt: now,
      updatedAt: now,
    } satisfies ApplicationDraft;
    const job = {
      id: draft.jobId,
      organizationId: "org_550e8400-e29b-41d4-a716-446655440000",
      organizationName: "Northstar Systems",
      title: "Product Engineer",
      summary: "Build useful systems.",
      categories: ["software_engineering"],
      workModel: "remote",
      employmentType: "full_time",
      seniority: "senior",
      locations: ["Europe"],
      skills: ["TypeScript"],
      salary: null,
      source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
      applyMode: "internal",
      status: "open",
      publishedAt: now,
      updatedAt: now,
    } satisfies Job;

    expect(
      adapter.prepare({
        ownerId: draft.ownerId,
        draft,
        job,
        reviewId: "review_550e8400-e29b-41d4-a716-446655440000",
        reviewPayloadHash: applicationReviewPayloadHash(draft, job),
        confirmationId: "confirmation_550e8400-e29b-41d4-a716-446655440000",
        idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
        now,
      }),
    ).toMatchObject({
      id: ids.managed_delivery,
      provider: "jobbbler_demo",
      providerReferenceId: ids.demo_submission,
      role: { id: job.id, title: job.title },
      recipientId: job.organizationId,
      recipientName: job.organizationName,
      status: "acknowledged",
      acknowledgedAt: now,
      fields: [
        expect.objectContaining({
          fieldKey: "full_name",
          label: "Full name",
          value: "Ada Lovelace",
        }),
        expect.objectContaining({ fieldKey: "email", label: "Email", value: "ada@example.test" }),
        expect.objectContaining({
          fieldKey: "location",
          label: "Current location",
          value: "London, United Kingdom",
        }),
        expect.objectContaining({
          fieldKey: "cover_letter",
          label: "Cover letter",
          value: "Build useful systems.",
        }),
        expect.objectContaining({
          fieldKey: "work_authorization",
          label: "Work authorization",
          value: "Authorized to work in the European Union",
        }),
      ],
    });

    expect(() =>
      adapter.prepare({
        ownerId: draft.ownerId,
        draft,
        job,
        reviewId: "review_550e8400-e29b-41d4-a716-446655440000",
        reviewPayloadHash: "a".repeat(64),
        confirmationId: "confirmation_550e8400-e29b-41d4-a716-446655440000",
        idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
        now,
      }),
    ).toThrow(/no longer matches the exact reviewed field presentation/i);
  });
});
