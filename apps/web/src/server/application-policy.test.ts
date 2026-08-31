import { describe, expect, it } from "vitest";

import type { Job } from "@jobbbler/contracts";
import type { ApplicationReviewRecord } from "@jobbbler/storage";

import {
  applicationDisclosureFor,
  applicationConsentPresentation,
  applicationPolicy,
  applicationReviewFieldSnapshotHash,
  applicationReviewPayloadHash,
  assertRequestedDisclosureMatches,
  normalizeApplicationAnswer,
  normalizeLegacyApplicationDraft,
} from "./application-policy";

const draft = {
  id: "application_550e8400-e29b-41d4-a716-446655440000",
  ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
  jobId: "job_550e8400-e29b-41d4-a716-446655440000",
  state: "reviewed" as const,
  version: 4,
  answers: [
    {
      fieldKey: "full_name",
      value: "Ada Lovelace",
      provenance: "user_entered" as const,
      sensitive: true,
      acceptedByHuman: true,
    },
    {
      fieldKey: "cover_letter",
      value: "A role-specific cover letter prepared from candidate-provided facts.",
      provenance: "agent_suggestion" as const,
      sensitive: true,
      acceptedByHuman: false,
    },
  ],
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:04:00.000Z",
};

const job = {
  id: draft.jobId,
  organizationId: "organization_550e8400-e29b-41d4-a716-446655440000",
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
  publishedAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
} satisfies Job;

const review: ApplicationReviewRecord = {
  id: "review_550e8400-e29b-41d4-a716-446655440000",
  ownerId: draft.ownerId,
  draftId: draft.id,
  draftVersion: draft.version,
  payloadHash: applicationReviewPayloadHash(draft, job),
  findings: [],
  status: "active",
  createdAt: draft.updatedAt,
  invalidatedAt: null,
};

describe("application disclosure policy", () => {
  it("defines a compact internal application with explicit sensitive categories", () => {
    expect(applicationPolicy.requirements.map(({ fieldKey }) => fieldKey)).toEqual([
      "full_name",
      "email",
      "location",
      "portfolio_url",
      "cover_letter",
      "work_authorization",
    ]);
    expect(applicationPolicy.requirements.filter(({ required }) => required)).toHaveLength(5);
    expect(
      applicationPolicy.requirements.find(({ fieldKey }) => fieldKey === "cover_letter"),
    ).toMatchObject({
      label: "Cover letter",
      input: "textarea",
      required: true,
      sensitive: true,
      category: "application_answers",
    });
    expect(applicationPolicy.noticeVersion).toMatch(/^privacy-/);
    expect(applicationPolicy.legalBasis).toBe("consent");
  });

  it("includes only accepted non-empty answers in the disclosure", () => {
    expect(applicationDisclosureFor(draft)).toEqual({
      categories: ["identity"],
      fieldKeys: ["full_name"],
      documentIds: [],
    });
  });

  it("invalidates earlier consent evidence after the application consent boundary advances", () => {
    const completeDraft = {
      ...draft,
      answers: [
        ...draft.answers,
        ...[
          ["email", "ada@example.com"],
          ["location", "London, UK"],
          ["work_authorization", "Yes"],
        ].map(([fieldKey, value]) => ({
          fieldKey: fieldKey!,
          value: value!,
          provenance: "user_entered" as const,
          sensitive: true,
          acceptedByHuman: true,
        })),
      ],
    };
    const before = applicationConsentPresentation({ ...completeDraft, consentRevision: 0 }, job);
    const after = applicationConsentPresentation({ ...completeDraft, consentRevision: 1 }, job);

    expect(before.fields).toEqual([
      { fieldKey: "full_name", label: "Full name", value: "Ada Lovelace", sensitive: true },
      {
        fieldKey: "email",
        label: "Email",
        value: "ada@example.com",
        sensitive: true,
      },
      {
        fieldKey: "location",
        label: "Current location",
        value: "London, UK",
        sensitive: true,
      },
      {
        fieldKey: "cover_letter",
        label: "Cover letter",
        value: "A role-specific cover letter prepared from candidate-provided facts.",
        sensitive: true,
      },
      {
        fieldKey: "work_authorization",
        label: "Work authorization",
        value: "Yes",
        sensitive: true,
      },
    ]);
    expect(after.valuesHash).not.toBe(before.valuesHash);
  });

  it("maps the former motivation answer to the cover-letter field for existing applications", () => {
    const legacy = {
      ...draft,
      answers: [
        draft.answers[0]!,
        {
          fieldKey: "motivation",
          value: "A legacy role-specific note.",
          provenance: "user_entered" as const,
          sensitive: false,
          acceptedByHuman: true,
        },
      ],
    };

    expect(normalizeLegacyApplicationDraft(legacy).answers).toEqual([
      draft.answers[0],
      {
        fieldKey: "cover_letter",
        value: "A legacy role-specific note.",
        provenance: "user_entered",
        sensitive: true,
        acceptedByHuman: true,
      },
    ]);
  });

  it("binds field labels into the immutable review boundary", () => {
    const completeDraft = {
      ...draft,
      answers: [
        ...draft.answers,
        ...[
          ["email", "ada@example.com"],
          ["location", "London, UK"],
          ["work_authorization", "Yes"],
        ].map(([fieldKey, value]) => ({
          fieldKey: fieldKey!,
          value: value!,
          provenance: "user_entered" as const,
          sensitive: true,
          acceptedByHuman: true,
        })),
      ],
    };
    const fields = applicationConsentPresentation(completeDraft, job).fields;
    const renamed = fields.map((field) =>
      field.fieldKey === "full_name" ? { ...field, label: "Legal name" } : field,
    );

    expect(applicationReviewFieldSnapshotHash(renamed)).not.toBe(
      applicationReviewFieldSnapshotHash(fields),
    );
    expect(applicationReviewPayloadHash(draft, job)).toBe(
      "938251de01fc74a61551c3eff21d7af34a741f6df5ee325e24f94e0f22b83bf6",
    );
  });

  it("rejects an exact review that cannot fit the bounded review snapshot", () => {
    const oversized = {
      ...draft,
      answers: applicationPolicy.requirements.map(({ fieldKey, sensitive }) => ({
        fieldKey,
        value: "😀".repeat(10_000),
        provenance: "user_entered" as const,
        sensitive,
        acceptedByHuman: true,
      })),
    };

    expect(() => applicationConsentPresentation(oversized, job)).toThrow(
      /too large for the bounded review snapshot.*shorten/i,
    );
  });

  it("rejects recipient, payload, or field drift from the current immutable review", () => {
    const disclosure = applicationDisclosureFor(draft);
    const exact = {
      recipientId: job.organizationId,
      purpose: `Submit this reviewed application to ${job.organizationName}.`,
      payloadHash: review.payloadHash,
      categories: disclosure.categories,
      fieldKeys: disclosure.fieldKeys,
      documentIds: disclosure.documentIds,
      noticeVersion: applicationPolicy.noticeVersion,
      legalBasis: applicationPolicy.legalBasis,
    } as const;
    expect(() =>
      assertRequestedDisclosureMatches({ draft, review, job, request: exact }),
    ).not.toThrow();
    expect(() =>
      assertRequestedDisclosureMatches({
        draft,
        review,
        job,
        request: { ...exact, fieldKeys: [...exact.fieldKeys, "email"] },
      }),
    ).toThrow(/exact reviewed disclosure/i);
    expect(() =>
      assertRequestedDisclosureMatches({
        draft,
        review,
        job: {
          ...job,
          organizationId: "organization_550e8400-e29b-41d4-a716-446655440099",
        },
        request: exact,
      }),
    ).toThrow(/exact reviewed disclosure/i);
  });

  it("keeps agent suggestions unaccepted and rejects forged sensitivity metadata", () => {
    expect(
      normalizeApplicationAnswer(
        {
          fieldKey: "cover_letter",
          value: "A useful draft",
          provenance: "user_entered",
          sensitive: true,
          acceptedByHuman: true,
        },
        "agent",
      ),
    ).toMatchObject({ provenance: "agent_suggestion", acceptedByHuman: false });
    expect(() =>
      normalizeApplicationAnswer(
        {
          fieldKey: "email",
          value: "ada@example.com",
          provenance: "user_entered",
          sensitive: false,
          acceptedByHuman: true,
        },
        "human",
      ),
    ).toThrow(/sensitivity/i);
  });
});
