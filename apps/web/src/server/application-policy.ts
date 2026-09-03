import { createHash } from "node:crypto";

import {
  applicationAnswerSchema,
  applicationFieldDefinitionSchema,
  MAX_APPLICATION_SUBMISSION_REVIEW_FIELDS_BYTES,
  type ApplicationAnswer,
  type ApplicationDraft,
  type ApplicationFieldDefinition,
  type DataCategory,
  type Job,
  type LegalBasis,
  type RequestDataGrant,
} from "@jobbbler/contracts";
import { DomainError } from "@jobbbler/core-domain";
import { canonicalApplicationPayload } from "@jobbbler/jobs-domain";
import {
  requiresAgentClientSubmissionDecision,
  type ApplicationReviewRecord,
} from "@jobbbler/storage";

const requirements = applicationFieldDefinitionSchema.array().parse([
  {
    fieldKey: "full_name",
    label: "Full name",
    description: "The name shared with the hiring team.",
    input: "text",
    required: true,
    sensitive: true,
    category: "identity",
    options: [],
  },
  {
    fieldKey: "email",
    label: "Email",
    description: "A contact address for this application.",
    input: "email",
    required: true,
    sensitive: true,
    category: "contact",
    options: [],
  },
  {
    fieldKey: "location",
    label: "Current location",
    description: "City and country; a street address is not needed.",
    input: "text",
    required: true,
    sensitive: true,
    category: "contact",
    options: [],
  },
  {
    fieldKey: "portfolio_url",
    label: "Portfolio or profile",
    description: "An optional HTTPS link to relevant work.",
    input: "url",
    required: false,
    sensitive: false,
    category: "work_history",
    options: [],
  },
  {
    fieldKey: "cover_letter",
    label: "Cover letter",
    description:
      "A role-specific letter prepared only from facts you supplied; your CV stays with you and your agent.",
    input: "textarea",
    required: true,
    sensitive: true,
    category: "application_answers",
    options: [],
  },
  {
    fieldKey: "work_authorization",
    label: "Work authorization",
    description:
      "Optional. Include it only when the person has already stated it; never ask for it to complete an application.",
    input: "select",
    required: false,
    sensitive: true,
    category: "work_authorization",
    options: [
      "Authorized to work in the European Union",
      "Authorized to work in the United States",
      "Authorized in another location",
      "Sponsorship would be required",
      "Prefer to discuss with the employer",
    ],
  },
]);

export function requiresAgentClientApplicationDecision(
  draft: Pick<ApplicationDraft, "answers">,
  delegations: readonly Readonly<{
    status: "requested" | "active" | "revoked";
    expiresAt: string;
  }>[],
  now: string,
): boolean {
  return requiresAgentClientSubmissionDecision(draft, delegations, now);
}

export const applicationPolicy: Readonly<{
  requirements: readonly ApplicationFieldDefinition[];
  noticeVersion: string;
  legalBasis: LegalBasis;
}> = Object.freeze({
  requirements: Object.freeze(requirements),
  noticeVersion: "privacy-2026-08-31",
  legalBasis: "consent",
});

/**
 * Keeps pre-release applications usable after the role note became an explicit
 * cover letter. The content is unchanged; the new policy treats it as private
 * because it can contain personal career context.
 */
export function normalizeLegacyApplicationDraft(draft: ApplicationDraft): ApplicationDraft {
  if (draft.answers.some(({ fieldKey }) => fieldKey === "cover_letter")) return draft;
  if (!draft.answers.some(({ fieldKey }) => fieldKey === "motivation")) return draft;
  return {
    ...draft,
    answers: draft.answers.map((answer) =>
      answer.fieldKey === "motivation"
        ? { ...answer, fieldKey: "cover_letter", sensitive: true }
        : answer,
    ),
  };
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

type ApplicationReviewFieldSnapshot = Readonly<{
  fieldKey: string;
  label: string;
  value: ApplicationAnswer["value"];
  sensitive: boolean;
}>;

function applicationReviewFields(
  draft: ApplicationDraft,
): readonly ApplicationReviewFieldSnapshot[] {
  return applicationPolicy.requirements.flatMap(({ fieldKey, label, sensitive }) => {
    const answer = draft.answers.find((candidate) => candidate.fieldKey === fieldKey);
    return answer !== undefined && hasValue(answer.value)
      ? [{ fieldKey, label, value: answer.value, sensitive }]
      : [];
  });
}

export function applicationReviewFieldSnapshotHash(
  fields: readonly ApplicationReviewFieldSnapshot[],
): string {
  return createHash("sha256")
    .update("jobbbler:application-review-fields:v1\u0000")
    .update(JSON.stringify(fields))
    .digest("hex");
}

export function applicationConsentPresentation(
  draft: ApplicationDraft,
  job: Job,
): Readonly<{
  recipientId: string;
  recipientName: string;
  purpose: string;
  categories: readonly DataCategory[];
  fieldKeys: readonly string[];
  fieldLabels: readonly string[];
  fields: readonly Readonly<{
    fieldKey: string;
    label: string;
    value: ApplicationAnswer["value"];
    sensitive: boolean;
  }>[];
  documentIds: readonly string[];
  noticeVersion: string;
  legalBasis: LegalBasis;
  valuesHash: string;
}> {
  const included = applicationPolicy.requirements.filter((requirement) => {
    const answer = draft.answers.find(({ fieldKey }) => fieldKey === requirement.fieldKey);
    return answer !== undefined && hasValue(answer.value);
  });
  const missing = applicationPolicy.requirements
    .filter(({ required }) => required)
    .filter((requirement) => !included.some(({ fieldKey }) => fieldKey === requirement.fieldKey));
  if (missing.length > 0) {
    throw new DomainError({
      code: "VALIDATION",
      message: `Required fields are incomplete: ${missing.map(({ fieldKey }) => fieldKey).join(", ")}.`,
    });
  }
  const normalizedValues = included.map(({ fieldKey }) => {
    const answer = draft.answers.find((candidate) => candidate.fieldKey === fieldKey)!;
    return { fieldKey, value: answer.value };
  });
  const fields = applicationReviewFields(draft);
  if (
    new TextEncoder().encode(JSON.stringify(fields)).byteLength >
    MAX_APPLICATION_SUBMISSION_REVIEW_FIELDS_BYTES
  ) {
    throw new DomainError({
      code: "VALIDATION",
      message:
        "The exact application review is too large for the bounded review snapshot. Shorten one or more answers before requesting review again.",
    });
  }
  return {
    recipientId: job.organizationId,
    recipientName: job.organizationName,
    purpose: applicationPurpose(job),
    categories: [...new Set(included.map(({ category }) => category))],
    fieldKeys: included.map(({ fieldKey }) => fieldKey),
    fieldLabels: included.map(({ label }) => label),
    fields,
    documentIds: [],
    noticeVersion: applicationPolicy.noticeVersion,
    legalBasis: applicationPolicy.legalBasis,
    valuesHash: createHash("sha256")
      .update("jobbbler:application-consent-values:v2\u0000")
      .update(
        JSON.stringify({
          consentRevision: draft.consentRevision ?? 0,
          values: normalizedValues,
        }),
      )
      .digest("hex"),
  };
}

export function applicationPurpose(job: Pick<Job, "organizationName" | "applyMode">): string {
  return job.applyMode === "external"
    ? `Continue on ${job.organizationName}'s website without a Jobbbler application workflow.`
    : `Submit this reviewed application to ${job.organizationName}.`;
}

export function applicationDisclosureFor(draft: ApplicationDraft): Readonly<{
  categories: readonly DataCategory[];
  fieldKeys: readonly string[];
  documentIds: readonly string[];
}> {
  const included = applicationPolicy.requirements.filter((requirement) => {
    const answer = draft.answers.find(({ fieldKey }) => fieldKey === requirement.fieldKey);
    return answer?.acceptedByHuman === true && hasValue(answer.value);
  });
  return {
    categories: [...new Set(included.map(({ category }) => category))],
    fieldKeys: included.map(({ fieldKey }) => fieldKey),
    documentIds: [],
  };
}

export function applicationDataGrantScope(
  input: Readonly<{
    draft: ApplicationDraft;
    review: ApplicationReviewRecord;
    job: Job;
  }>,
): Readonly<{
  recipientId: string;
  purpose: string;
  payloadHash: string;
  categories: readonly DataCategory[];
  fieldKeys: readonly string[];
  documentIds: readonly string[];
  noticeVersion: string;
  legalBasis: LegalBasis;
}> {
  const disclosure = applicationDisclosureFor(input.draft);
  return {
    recipientId: input.job.organizationId,
    purpose: applicationPurpose(input.job),
    payloadHash: input.review.payloadHash,
    categories: disclosure.categories,
    fieldKeys: disclosure.fieldKeys,
    documentIds: disclosure.documentIds,
    noticeVersion: applicationPolicy.noticeVersion,
    legalBasis: applicationPolicy.legalBasis,
  };
}

export function hashApplicationReviewSnapshot(
  input: Readonly<{
    canonicalDraftPayload: string;
    draft: ApplicationDraft;
    job: Job;
  }>,
): string {
  const disclosure = applicationDisclosureFor(input.draft);
  const boundary = JSON.stringify({
    canonicalDraftPayload: input.canonicalDraftPayload,
    job: {
      id: input.job.id,
      organizationId: input.job.organizationId,
      organizationName: input.job.organizationName,
      applyMode: input.job.applyMode,
      sourceUrl: input.job.applyMode === "external" ? input.job.source.url : null,
    },
    disclosure: {
      recipientId: input.job.organizationId,
      purpose: applicationPurpose(input.job),
      categories: disclosure.categories,
      fieldKeys: disclosure.fieldKeys,
      documentIds: disclosure.documentIds,
      noticeVersion: applicationPolicy.noticeVersion,
      legalBasis: applicationPolicy.legalBasis,
      fieldSnapshotHash: applicationReviewFieldSnapshotHash(applicationReviewFields(input.draft)),
    },
  });
  return createHash("sha256")
    .update("jobbbler:application-review:v2\u0000")
    .update(boundary)
    .digest("hex");
}

export function applicationReviewPayloadHash(draft: ApplicationDraft, job: Job): string {
  return hashApplicationReviewSnapshot({
    canonicalDraftPayload: canonicalApplicationPayload({ ...draft, requiredFieldKeys: [] }),
    draft,
    job,
  });
}

export function normalizeApplicationAnswer(
  raw: unknown,
  actor: "human" | "agent",
): ApplicationAnswer {
  const parsed = applicationAnswerSchema.parse(raw);
  const requirement = applicationPolicy.requirements.find(
    ({ fieldKey }) => fieldKey === parsed.fieldKey,
  );
  if (requirement === undefined) {
    throw new DomainError({
      code: "VALIDATION",
      message: "The application field is not supported.",
    });
  }
  if (parsed.sensitive !== requirement.sensitive) {
    throw new DomainError({
      code: "VALIDATION",
      message: "Application field sensitivity metadata does not match policy.",
    });
  }
  if (typeof parsed.value !== "string") {
    throw new DomainError({
      code: "VALIDATION",
      message: "This application field expects a text value.",
    });
  }
  const value = parsed.value.trim();
  if (
    requirement.input === "email" &&
    value.length > 0 &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
  ) {
    throw new DomainError({ code: "VALIDATION", message: "Enter a valid email address." });
  }
  if (requirement.input === "url" && value.length > 0 && !/^https:\/\//u.test(value)) {
    throw new DomainError({ code: "VALIDATION", message: "Portfolio links must use HTTPS." });
  }
  if (requirement.input === "select" && value.length > 0 && !requirement.options.includes(value)) {
    throw new DomainError({ code: "VALIDATION", message: "Choose a supported field option." });
  }
  return {
    ...parsed,
    value,
    ...(actor === "agent"
      ? { provenance: "agent_suggestion" as const, acceptedByHuman: false }
      : {}),
  };
}

function equal(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function assertRequestedDisclosureMatches(
  input: Readonly<{
    draft: ApplicationDraft;
    review: ApplicationReviewRecord;
    job: Job;
    request: Readonly<{
      recipientId: RequestDataGrant["recipientId"];
      purpose: RequestDataGrant["purpose"];
      categories: readonly DataCategory[];
      fieldKeys: readonly string[];
      documentIds: readonly string[];
      payloadHash: RequestDataGrant["payloadHash"];
      noticeVersion: RequestDataGrant["noticeVersion"];
      legalBasis: RequestDataGrant["legalBasis"];
    }>;
  }>,
): void {
  const expected = applicationDataGrantScope(input);
  const matchesReview =
    input.draft.state === "reviewed" &&
    input.review.status === "active" &&
    input.review.ownerId === input.draft.ownerId &&
    input.review.draftId === input.draft.id &&
    input.review.draftVersion === input.draft.version &&
    input.review.payloadHash === applicationReviewPayloadHash(input.draft, input.job);
  const matchesBoundary =
    input.job.id === input.draft.jobId &&
    input.request.recipientId === expected.recipientId &&
    input.request.purpose === expected.purpose &&
    input.request.payloadHash === expected.payloadHash &&
    input.request.noticeVersion === expected.noticeVersion &&
    input.request.legalBasis === expected.legalBasis &&
    equal(input.request.categories, expected.categories) &&
    equal(input.request.fieldKeys, expected.fieldKeys) &&
    equal(input.request.documentIds, expected.documentIds);

  if (!matchesReview || !matchesBoundary) {
    throw new DomainError({
      code: "CONFLICT",
      message: "The request does not match the exact reviewed disclosure.",
    });
  }
}
