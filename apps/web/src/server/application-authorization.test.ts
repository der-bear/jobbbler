import { describe, expect, it, vi } from "vitest";

import type { ApplicationDraft, Job, RequestDataGrant } from "@jobbbler/contracts";
import type { ApplicationReviewRecord, RichDataGrantRecord } from "@jobbbler/storage";

import { createApplicationDataGrantAuthorizationPolicy } from "./application-authorization";
import {
  applicationDisclosureFor,
  applicationPolicy,
  applicationPurpose,
  applicationReviewPayloadHash,
} from "./application-policy";

const now = "2026-08-29T10:00:00.000Z";
const ownerId = "owner_73000000-0000-7000-8000-000000000001";
const draftId = "application_73000000-0000-7000-8000-000000000001";

const draft: ApplicationDraft = {
  id: draftId,
  ownerId,
  jobId: "job_73000000-0000-7000-8000-000000000001",
  state: "reviewed",
  version: 3,
  answers: [
    {
      fieldKey: "full_name",
      value: "Ada Lovelace",
      provenance: "user_entered",
      sensitive: true,
      acceptedByHuman: true,
    },
  ],
  createdAt: now,
  updatedAt: now,
};

const job: Job = {
  id: draft.jobId,
  organizationId: "organization_73000000-0000-7000-8000-000000000001",
  organizationName: "Northstar Systems",
  title: "Senior Product Engineer",
  summary: "Build trustworthy tools.",
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
};

const review: ApplicationReviewRecord = {
  id: "review_73000000-0000-7000-8000-000000000001",
  ownerId,
  draftId,
  draftVersion: draft.version,
  payloadHash: applicationReviewPayloadHash(draft, job),
  findings: [],
  status: "active",
  createdAt: now,
  invalidatedAt: null,
};

const disclosure = applicationDisclosureFor(draft);
const exactRequest = {
  recipientId: job.organizationId,
  purpose: applicationPurpose(job),
  payloadHash: review.payloadHash,
  categories: [...disclosure.categories],
  fieldKeys: [...disclosure.fieldKeys],
  documentIds: [...disclosure.documentIds],
  noticeVersion: applicationPolicy.noticeVersion,
  legalBasis: applicationPolicy.legalBasis,
} satisfies Omit<RequestDataGrant, "draftId">;

function repositories(options: { readonly review?: ApplicationReviewRecord | null } = {}) {
  return {
    applications: {
      getByOwner: vi.fn(async () => draft),
      getLatestReview: vi.fn(async () => (options.review === undefined ? review : options.review)),
    },
    jobs: {
      getById: vi.fn(async () => job),
    },
  };
}

describe("application data-grant authorization composition", () => {
  it("accepts only the exact owner-bound current reviewed disclosure", async () => {
    const current = repositories();
    const policy = createApplicationDataGrantAuthorizationPolicy(current);

    await expect(
      policy.assertDataGrantRequest({ ownerId, draftId, request: exactRequest }),
    ).resolves.toBeUndefined();
    expect(current.applications.getByOwner).toHaveBeenCalledWith(draftId, ownerId);
    expect(current.applications.getLatestReview).toHaveBeenCalledWith(draftId, ownerId);
    expect(current.jobs.getById).toHaveBeenCalledWith(job.id);

    const stored: RichDataGrantRecord = {
      id: "grant_73000000-0000-7000-8000-000000000010",
      ownerId,
      draftId,
      ...exactRequest,
      status: "requested",
      expiresAt: "2026-08-29T10:15:00.000Z",
      createdAt: now,
      approvedAt: null,
      withdrawnAt: null,
      version: 4,
    };
    await expect(policy.assertStoredDataGrantCurrent(stored)).resolves.toEqual({
      expectedGrantVersion: 4,
      expectedDraftVersion: draft.version,
      reviewId: review.id,
      reviewPayloadHash: review.payloadHash,
      jobId: job.id,
      jobOrganizationId: job.organizationId,
      jobOrganizationName: job.organizationName,
      jobApplyMode: "internal",
    });

    await expect(
      policy.assertDataGrantRequest({
        ownerId,
        draftId,
        request: { ...exactRequest, fieldKeys: [...exactRequest.fieldKeys, "email"] },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("revalidates a stored grant and rejects approval after the review becomes stale", async () => {
    const staleReview = { ...review, draftVersion: review.draftVersion - 1 };
    const policy = createApplicationDataGrantAuthorizationPolicy(
      repositories({ review: staleReview }),
    );
    const stored: RichDataGrantRecord = {
      id: "grant_73000000-0000-7000-8000-000000000001",
      ownerId,
      draftId,
      ...exactRequest,
      status: "requested",
      expiresAt: "2026-08-29T10:15:00.000Z",
      createdAt: now,
      approvedAt: null,
      withdrawnAt: null,
    };

    await expect(policy.assertStoredDataGrantCurrent(stored)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("never presents or authorizes disclosure for a legacy external draft", async () => {
    const externalJob: Job = {
      ...job,
      applyMode: "external",
      source: {
        key: "external_source",
        label: "External source",
        url: "https://jobs.example.test/opening/42",
      },
    };
    const externalReview: ApplicationReviewRecord = {
      ...review,
      payloadHash: applicationReviewPayloadHash(draft, externalJob),
    };
    const externalRequest = {
      ...exactRequest,
      purpose: applicationPurpose(externalJob),
      payloadHash: externalReview.payloadHash,
    };
    const current = repositories({ review: externalReview });
    current.jobs.getById.mockResolvedValue(externalJob);
    const policy = createApplicationDataGrantAuthorizationPolicy(current);

    await expect(policy.consentPresentation(ownerId, draftId)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This role accepts applications on the employer's website.",
    });
    await expect(
      policy.assertDataGrantRequest({ ownerId, draftId, request: externalRequest }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This role accepts applications on the employer's website.",
    });
  });
});
