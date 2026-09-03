import { applicationAgentSessionResultSchema } from "@jobbbler/contracts";

import type { ApplicationAgentCredential } from "./application-model";

export interface ApplicationAgentCredentialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredApplicationAgentCredential {
  readonly version: 1;
  readonly draftId: string;
  readonly credential: ApplicationAgentCredential;
}

const STORAGE_KEY_PREFIX = "jobbbler:application-agent-credential:";

function storageKey(draftId: string): string {
  return `${STORAGE_KEY_PREFIX}${draftId}`;
}

function isLive(expiresAt: string, now: string): boolean {
  const expiry = Date.parse(expiresAt);
  const current = Date.parse(now);
  return Number.isFinite(expiry) && Number.isFinite(current) && expiry > current;
}

export function clearApplicationAgentCredential(
  storage: ApplicationAgentCredentialStorage,
  draftId: string,
): void {
  try {
    storage.removeItem(storageKey(draftId));
  } catch {
    // The in-memory credential still expires independently when storage is unavailable.
  }
}

export function storeApplicationAgentCredential(
  storage: ApplicationAgentCredentialStorage,
  draftId: string,
  credential: ApplicationAgentCredential,
  now: string,
): void {
  const parsed = applicationAgentSessionResultSchema.safeParse(credential);
  if (!parsed.success || !isLive(parsed.data.expiresAt, now)) {
    clearApplicationAgentCredential(storage, draftId);
    return;
  }
  const stored: StoredApplicationAgentCredential = {
    version: 1,
    draftId,
    credential: parsed.data,
  };
  try {
    storage.setItem(storageKey(draftId), JSON.stringify(stored));
  } catch {
    // Session storage can be disabled; the caller keeps the credential in memory for this mount.
  }
}

export function restoreApplicationAgentCredential(
  storage: ApplicationAgentCredentialStorage,
  draftId: string,
  now: string,
): ApplicationAgentCredential | null {
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(draftId));
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const candidate = JSON.parse(raw) as Partial<StoredApplicationAgentCredential>;
    const credential = applicationAgentSessionResultSchema.safeParse(candidate.credential);
    if (
      candidate.version !== 1 ||
      candidate.draftId !== draftId ||
      !credential.success ||
      !isLive(credential.data.expiresAt, now)
    ) {
      clearApplicationAgentCredential(storage, draftId);
      return null;
    }
    return credential.data;
  } catch {
    clearApplicationAgentCredential(storage, draftId);
    return null;
  }
}

/*
 * The envelope of a pending submission review — never its values.
 *
 * A person who opens the application page to look at what they are approving
 * remounts this surface, and the review the agent is holding used to disappear
 * with it: the agent then had to ask for the same approval a second time. Only
 * the identifiers travel through storage; the answers stay on the server, and
 * the decision is still checked there against the exact frozen payload.
 */
export interface StoredSubmissionReviewEnvelope {
  readonly id: string;
  readonly draftId: string;
  readonly draftVersion: number;
  readonly recipient: string;
  readonly purpose: string;
  readonly noticeVersion: string;
  readonly expiresAt: string;
}

const REVIEW_KEY_PREFIX = "jobbbler:application-submission-review:";

function reviewKey(draftId: string): string {
  return `${REVIEW_KEY_PREFIX}${draftId}`;
}

export function clearApplicationSubmissionReview(
  storage: ApplicationAgentCredentialStorage,
  draftId: string,
): void {
  try {
    storage.removeItem(reviewKey(draftId));
  } catch {
    // The in-memory review expires on its own when storage is unavailable.
  }
}

export function storeApplicationSubmissionReview(
  storage: ApplicationAgentCredentialStorage,
  draftId: string,
  review: StoredSubmissionReviewEnvelope,
  now: string,
): void {
  if (review.draftId !== draftId || !isLive(review.expiresAt, now)) {
    clearApplicationSubmissionReview(storage, draftId);
    return;
  }
  try {
    storage.setItem(reviewKey(draftId), JSON.stringify({ version: 1, draftId, review }));
  } catch {
    // Without storage the review still works for as long as this page stays open.
  }
}

export function restoreApplicationSubmissionReview(
  storage: ApplicationAgentCredentialStorage,
  draftId: string,
  now: string,
): StoredSubmissionReviewEnvelope | null {
  let raw: string | null;
  try {
    raw = storage.getItem(reviewKey(draftId));
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const candidate = JSON.parse(raw) as {
      version?: number;
      draftId?: string;
      review?: Partial<StoredSubmissionReviewEnvelope>;
    };
    const review = candidate.review;
    if (
      candidate.version !== 1 ||
      candidate.draftId !== draftId ||
      review === undefined ||
      review.id === undefined ||
      review.draftId !== draftId ||
      typeof review.draftVersion !== "number" ||
      review.recipient === undefined ||
      review.purpose === undefined ||
      review.noticeVersion === undefined ||
      review.expiresAt === undefined ||
      !isLive(review.expiresAt, now)
    ) {
      clearApplicationSubmissionReview(storage, draftId);
      return null;
    }
    return review as StoredSubmissionReviewEnvelope;
  } catch {
    clearApplicationSubmissionReview(storage, draftId);
    return null;
  }
}
