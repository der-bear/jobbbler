import { describe, expect, it } from "vitest";

import type { ApplicationAgentCredential } from "./application-model";
import {
  clearApplicationAgentCredential,
  restoreApplicationAgentCredential,
  storeApplicationAgentCredential,
  type ApplicationAgentCredentialStorage,
} from "./application-agent-credential-vault";

const now = "2026-08-29T10:00:00.000Z";
const draftId = "draft_550e8400-e29b-41d4-a716-446655440000";
const otherDraftId = "draft_650e8400-e29b-41d4-a716-446655440000";

function credential(
  sessionId: string,
  expiresAt = "2026-08-29T10:15:00.000Z",
): ApplicationAgentCredential {
  return { sessionId, token: "a".repeat(43), expiresAt };
}

function memoryStorage(): ApplicationAgentCredentialStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe("application agent credential vault", () => {
  it("restores a live credential only for the draft that issued it", () => {
    const storage = memoryStorage();
    const first = credential("agent_session_550e8400-e29b-41d4-a716-446655440000");
    const second = credential("agent_session_650e8400-e29b-41d4-a716-446655440000");

    storeApplicationAgentCredential(storage, draftId, first, now);
    storeApplicationAgentCredential(storage, otherDraftId, second, now);

    expect(restoreApplicationAgentCredential(storage, draftId, now)).toEqual(first);
    expect(restoreApplicationAgentCredential(storage, otherDraftId, now)).toEqual(second);
  });

  it("removes an expired credential instead of restoring it", () => {
    const storage = memoryStorage();
    storeApplicationAgentCredential(
      storage,
      draftId,
      credential("agent_session_550e8400-e29b-41d4-a716-446655440000", "2026-08-29T10:00:00.000Z"),
      "2026-08-29T09:59:59.000Z",
    );

    expect(restoreApplicationAgentCredential(storage, draftId, now)).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  it("fails closed and deletes malformed session data", () => {
    const storage = memoryStorage();
    storeApplicationAgentCredential(
      storage,
      draftId,
      credential("agent_session_550e8400-e29b-41d4-a716-446655440000"),
      now,
    );
    const key = [...storage.values.keys()][0];
    expect(key).toBeDefined();
    storage.values.set(key!, '{"draftId":"another-draft","token":"leaked"}');

    expect(restoreApplicationAgentCredential(storage, draftId, now)).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  it("clears only the requested draft credential", () => {
    const storage = memoryStorage();
    const first = credential("agent_session_550e8400-e29b-41d4-a716-446655440000");
    const second = credential("agent_session_650e8400-e29b-41d4-a716-446655440000");
    storeApplicationAgentCredential(storage, draftId, first, now);
    storeApplicationAgentCredential(storage, otherDraftId, second, now);

    clearApplicationAgentCredential(storage, draftId);

    expect(restoreApplicationAgentCredential(storage, draftId, now)).toBeNull();
    expect(restoreApplicationAgentCredential(storage, otherDraftId, now)).toEqual(second);
  });

  it("keeps credentials in memory when session storage is unavailable", () => {
    const unavailable: ApplicationAgentCredentialStorage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => {
        throw new Error("storage unavailable");
      },
    };
    const current = credential("agent_session_550e8400-e29b-41d4-a716-446655440000");

    expect(() => storeApplicationAgentCredential(unavailable, draftId, current, now)).not.toThrow();
    expect(restoreApplicationAgentCredential(unavailable, draftId, now)).toBeNull();
    expect(() => clearApplicationAgentCredential(unavailable, draftId)).not.toThrow();
  });
});
