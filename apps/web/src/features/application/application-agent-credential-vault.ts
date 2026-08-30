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
