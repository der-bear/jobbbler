import type { ApplicationAnswer, ApplicationState } from "@jobbbler/contracts";

import { DomainError } from "@jobbbler/core-domain";

export interface ApplicationDraftRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly jobId: string;
  readonly state: ApplicationState;
  readonly version: number;
  readonly answers: readonly ApplicationAnswer[];
  readonly requiredFieldKeys: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApplicationReview {
  readonly id: string;
  readonly draftId: string;
  readonly ownerId: string;
  readonly draftVersion: number;
  readonly payloadHash: string;
  readonly status: "active" | "invalidated";
  readonly createdAt: string;
  readonly invalidatedAt: string | null;
}

export interface ApplicationConfirmation {
  readonly id: string;
  readonly draftId: string;
  readonly ownerId: string;
  readonly reviewId: string;
  readonly payloadHash: string;
  readonly expiresAt: string;
  readonly status: "active" | "consumed" | "invalidated";
  readonly createdAt: string;
  readonly consumedAt: string | null;
}

export interface ApplicationSubmissionReceipt {
  readonly id: string;
  readonly draftId: string;
  readonly ownerId: string;
  readonly reviewId: string;
  readonly idempotencyKey: string | null;
  readonly status: "submitted" | "handed_off";
  readonly externalUrl: string | null;
  readonly createdAt: string;
}

function owner(draft: ApplicationDraftRecord, ownerId: string): void {
  if (draft.ownerId !== ownerId)
    throw new DomainError({ code: "FORBIDDEN", message: "The draft owner does not match." });
}

export function canonicalApplicationPayload(draft: ApplicationDraftRecord): string {
  return JSON.stringify({
    draftId: draft.id,
    version: draft.version,
    answers: [...draft.answers].sort((left, right) => left.fieldKey.localeCompare(right.fieldKey)),
  });
}

function usableState(state: ApplicationState): boolean {
  return (
    state === "draft" ||
    state === "valid" ||
    state === "reviewed" ||
    state === "awaiting_confirmation"
  );
}

function answerIsComplete(answer: ApplicationAnswer | undefined): boolean {
  if (answer === undefined || !answer.acceptedByHuman || answer.value === null) return false;
  return typeof answer.value !== "string" || answer.value.trim().length > 0;
}

export function createApplicationDraft(
  input: Readonly<{
    id: string;
    ownerId: string;
    jobId: string;
    requiredFieldKeys: readonly string[];
    now: string;
  }>,
): ApplicationDraftRecord {
  if (new Set(input.requiredFieldKeys).size !== input.requiredFieldKeys.length)
    throw new DomainError({ code: "VALIDATION", message: "Required fields must be unique." });
  return {
    id: input.id,
    ownerId: input.ownerId,
    jobId: input.jobId,
    requiredFieldKeys: [...input.requiredFieldKeys],
    state: "draft",
    version: 0,
    answers: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function setApplicationAnswer(
  draft: ApplicationDraftRecord,
  input: Readonly<{
    ownerId: string;
    expectedVersion: number;
    answer: ApplicationAnswer;
    now: string;
    review?: ApplicationReview;
    confirmation?: ApplicationConfirmation;
  }>,
): Readonly<{
  draft: ApplicationDraftRecord;
  invalidatedReview?: ApplicationReview;
  invalidatedConfirmation?: ApplicationConfirmation;
}> {
  owner(draft, input.ownerId);
  if (!usableState(draft.state) || draft.version !== input.expectedVersion)
    throw new DomainError({ code: "CONFLICT", message: "The draft changed before this edit." });
  const previous = draft.answers.find((answer) => answer.fieldKey === input.answer.fieldKey);
  const materiallyChanged = JSON.stringify(previous) !== JSON.stringify(input.answer);
  const answers = [
    ...draft.answers.filter((answer) => answer.fieldKey !== input.answer.fieldKey),
    input.answer,
  ].sort((left, right) => left.fieldKey.localeCompare(right.fieldKey));
  const next: ApplicationDraftRecord = {
    ...draft,
    answers,
    version: materiallyChanged ? draft.version + 1 : draft.version,
    state: materiallyChanged ? "draft" : draft.state,
    updatedAt: input.now,
  };
  const invalidatedReview =
    materiallyChanged && input.review?.status === "active"
      ? { ...input.review, status: "invalidated" as const, invalidatedAt: input.now }
      : undefined;
  const invalidatedConfirmation =
    materiallyChanged && input.confirmation?.status === "active"
      ? { ...input.confirmation, status: "invalidated" as const }
      : undefined;
  return {
    draft: next,
    ...(invalidatedReview === undefined ? {} : { invalidatedReview }),
    ...(invalidatedConfirmation === undefined ? {} : { invalidatedConfirmation }),
  };
}

export function validateApplication(
  draft: ApplicationDraftRecord,
  ownerId: string,
  now: string,
): ApplicationDraftRecord {
  owner(draft, ownerId);
  if (!usableState(draft.state))
    throw new DomainError({ code: "CONFLICT", message: "This draft cannot be validated." });
  const missing = draft.requiredFieldKeys.filter(
    (fieldKey) => !answerIsComplete(draft.answers.find((answer) => answer.fieldKey === fieldKey)),
  );
  if (missing.length > 0)
    throw new DomainError({
      code: "VALIDATION",
      message: `Required fields are incomplete: ${missing.join(", ")}.`,
    });
  return draft.state === "valid"
    ? draft
    : { ...draft, state: "valid", version: draft.version + 1, updatedAt: now };
}

export function reviewApplication(
  draft: ApplicationDraftRecord,
  input: Readonly<{ id: string; ownerId: string; now: string; hash(payload: string): string }>,
): Readonly<{ draft: ApplicationDraftRecord; review: ApplicationReview }> {
  owner(draft, input.ownerId);
  if (draft.state !== "valid")
    throw new DomainError({ code: "CONFLICT", message: "Validate the draft before review." });
  const reviewedDraft = {
    ...draft,
    state: "reviewed" as const,
    version: draft.version + 1,
    updatedAt: input.now,
  };
  const payloadHash = input.hash(canonicalApplicationPayload(reviewedDraft));
  return {
    draft: reviewedDraft,
    review: {
      id: input.id,
      draftId: draft.id,
      ownerId: draft.ownerId,
      draftVersion: reviewedDraft.version,
      payloadHash,
      status: "active",
      createdAt: input.now,
      invalidatedAt: null,
    },
  };
}

export function confirmReview(
  draft: ApplicationDraftRecord,
  review: ApplicationReview,
  input: Readonly<{ id: string; ownerId: string; now: string; expiresAt: string }>,
): ApplicationConfirmation {
  owner(draft, input.ownerId);
  if (
    draft.state !== "reviewed" ||
    review.status !== "active" ||
    review.ownerId !== draft.ownerId ||
    review.draftId !== draft.id ||
    review.draftVersion !== draft.version ||
    Date.parse(input.expiresAt) <= Date.parse(input.now)
  ) {
    throw new DomainError({
      code: "CONFLICT",
      message: "A current immutable review is required for confirmation.",
    });
  }
  return {
    id: input.id,
    draftId: draft.id,
    ownerId: draft.ownerId,
    reviewId: review.id,
    payloadHash: review.payloadHash,
    expiresAt: input.expiresAt,
    status: "active",
    createdAt: input.now,
    consumedAt: null,
  };
}

function assertConfirmation(
  draft: ApplicationDraftRecord,
  review: ApplicationReview,
  confirmation: ApplicationConfirmation,
  ownerId: string,
  now: string,
): void {
  owner(draft, ownerId);
  if (confirmation.status === "consumed")
    throw new DomainError({ code: "CONFLICT", message: "The confirmation has already been used." });
  if (
    draft.state !== "reviewed" ||
    review.status !== "active" ||
    review.draftId !== draft.id ||
    review.ownerId !== ownerId ||
    review.draftVersion !== draft.version ||
    confirmation.status !== "active" ||
    confirmation.ownerId !== ownerId ||
    confirmation.draftId !== draft.id ||
    confirmation.reviewId !== review.id ||
    confirmation.payloadHash !== review.payloadHash
  ) {
    throw new DomainError({ code: "CONFLICT", message: "A current confirmed review is required." });
  }
  if (Date.parse(confirmation.expiresAt) <= Date.parse(now))
    throw new DomainError({ code: "CONFLICT", message: "The confirmation expired." });
}

export function submitInternal(
  draft: ApplicationDraftRecord,
  review: ApplicationReview,
  confirmation: ApplicationConfirmation,
  input: Readonly<{
    id: string;
    ownerId: string;
    idempotencyKey: string;
    now: string;
    existingReceipt?: ApplicationSubmissionReceipt;
  }>,
): Readonly<{
  draft: ApplicationDraftRecord;
  confirmation: ApplicationConfirmation;
  receipt: ApplicationSubmissionReceipt;
}> {
  if (
    input.existingReceipt !== undefined &&
    input.existingReceipt.ownerId === input.ownerId &&
    input.existingReceipt.draftId === draft.id &&
    input.existingReceipt.idempotencyKey === input.idempotencyKey
  ) {
    return { draft, confirmation, receipt: input.existingReceipt };
  }
  assertConfirmation(draft, review, confirmation, input.ownerId, input.now);
  const consumed = { ...confirmation, status: "consumed" as const, consumedAt: input.now };
  return {
    draft: {
      ...draft,
      state: "submitted",
      version: draft.version + 1,
      updatedAt: input.now,
    },
    confirmation: consumed,
    receipt: {
      id: input.id,
      draftId: draft.id,
      ownerId: input.ownerId,
      reviewId: review.id,
      idempotencyKey: input.idempotencyKey,
      status: "submitted",
      externalUrl: null,
      createdAt: input.now,
    },
  };
}

export function handOffExternal(
  draft: ApplicationDraftRecord,
  review: ApplicationReview,
  confirmation: ApplicationConfirmation,
  input: Readonly<{ id: string; ownerId: string; now: string; externalUrl: string }>,
): Readonly<{
  draft: ApplicationDraftRecord;
  confirmation: ApplicationConfirmation;
  receipt: ApplicationSubmissionReceipt;
}> {
  assertConfirmation(draft, review, confirmation, input.ownerId, input.now);
  if (!/^https:\/\//u.test(input.externalUrl))
    throw new DomainError({
      code: "VALIDATION",
      message: "External handoff requires a secure URL.",
    });
  return {
    draft: {
      ...draft,
      state: "handed_off",
      version: draft.version + 1,
      updatedAt: input.now,
    },
    confirmation: { ...confirmation, status: "consumed", consumedAt: input.now },
    receipt: {
      id: input.id,
      draftId: draft.id,
      ownerId: input.ownerId,
      reviewId: review.id,
      idempotencyKey: null,
      status: "handed_off",
      externalUrl: input.externalUrl,
      createdAt: input.now,
    },
  };
}

export function withdrawApplication(
  draft: ApplicationDraftRecord,
  ownerId: string,
  now: string,
): ApplicationDraftRecord {
  owner(draft, ownerId);
  if (draft.state === "submitted" || draft.state === "handed_off")
    throw new DomainError({
      code: "CONFLICT",
      message: "A completed application cannot be withdrawn here.",
    });
  return { ...draft, state: "withdrawn", version: draft.version + 1, updatedAt: now };
}
