import { describe, expect, it, vi } from "vitest";

import type {
  VerificationChallengeRecord,
  VerificationEndpointRecord,
} from "@jobbbler/core-domain";

import type { PostgresSql } from "./connection.js";

const postgres = vi.hoisted(() => ({ sql: undefined as unknown }));

vi.mock("./connection.js", () => ({
  openPostgresDatabase: () => postgres.sql,
}));

import { createPostgresStorage } from "./storage.js";

const now = "2026-08-30T09:00:00.000Z";
const pending: VerificationEndpointRecord = {
  id: "endpoint_550e8400-e29b-41d4-a716-446655440001",
  ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
  kind: "email",
  addressHash: "keyed-address-id",
  addressCiphertext: "original-envelope",
  maskedAddress: "p•••••@example.com",
  status: "pending",
  verifiedAt: null,
  createdAt: now,
  updatedAt: now,
};
const verified: VerificationEndpointRecord = {
  ...pending,
  status: "verified",
  verifiedAt: "2026-08-30T09:00:01.000Z",
  updatedAt: "2026-08-30T09:00:01.000Z",
};
const challenge: VerificationChallengeRecord = {
  id: "challenge_550e8400-e29b-41d4-a716-446655440002",
  ownerId: pending.ownerId,
  endpointId: pending.id,
  purpose: "search_alert_review",
  tokenHash: "challenge-token-hash",
  status: "pending",
  attempts: 0,
  maxAttempts: 5,
  expiresAt: "2026-08-30T09:10:00.000Z",
  consumedAt: null,
  createdAt: now,
  updatedAt: now,
};

function entity(record: { readonly id: string; readonly ownerId?: string }) {
  return { id: record.id, owner_id: record.ownerId ?? null, body: record, version: 0 };
}

describe("PostgreSQL verification endpoint monotonicity", () => {
  it("locks the matching endpoint before deciding whether a begin may write pending state", async () => {
    let storedEndpoint = pending;
    let storedChallenge: VerificationChallengeRecord | null = null;
    const query = Object.assign(
      vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const statement = strings.join("?").replaceAll(/\s+/g, " ").trim();
        if (
          statement.startsWith("SELECT id, owner_id, body, version") &&
          statement.includes("kind = 'verification_endpoint'")
        ) {
          if (statement.includes("FOR UPDATE")) {
            storedEndpoint = verified;
            return [entity(storedEndpoint)];
          }
          const stale = storedEndpoint;
          storedEndpoint = verified;
          return [entity(stale)];
        }
        if (
          statement.startsWith("SELECT id, owner_id, body, version") &&
          statement.includes("kind = ?")
        ) {
          const kind = values[0];
          if (kind === "verification_challenge") {
            return storedChallenge === null ? [] : [entity(storedChallenge)];
          }
          if (kind === "verification_endpoint") return [entity(storedEndpoint)];
          return [];
        }
        if (statement.startsWith("INSERT INTO jobbbler.entity_records")) {
          const candidate = values.find(
            (value): value is VerificationEndpointRecord | VerificationChallengeRecord =>
              typeof value === "object" && value !== null && "id" in value,
          );
          if (candidate?.id === pending.id)
            storedEndpoint = candidate as VerificationEndpointRecord;
          if (candidate?.id === challenge.id) {
            storedChallenge = candidate as VerificationChallengeRecord;
          }
          return [];
        }
        if (
          statement.startsWith("SELECT id, owner_id, body, version") &&
          statement.includes("ORDER BY updated_at")
        ) {
          return [];
        }
        throw new Error(`Unexpected SQL: ${statement}`);
      }),
      {
        begin: vi.fn(async (callback: (transaction: PostgresSql) => Promise<unknown>) =>
          callback(query as unknown as PostgresSql),
        ),
        json: vi.fn((value: unknown) => value),
        array: vi.fn((value: unknown) => value),
        end: vi.fn(),
      },
    );
    postgres.sql = query as unknown as PostgresSql;
    const storage = createPostgresStorage("postgresql://unused.test/jobbbler");

    const result = await storage.identity.beginEmailVerification({
      endpoint: { ...pending, addressCiphertext: "new-envelope" },
      challenge,
    });

    expect(result.endpoint).toEqual(verified);
    expect(storedEndpoint).toEqual(verified);
    expect(
      query.mock.calls.some(([strings]) =>
        (strings as TemplateStringsArray).join(" ").includes("FOR UPDATE"),
      ),
    ).toBe(true);
    await expect(
      storage.identity.beginEmailVerification({
        endpoint: { ...pending, addressCiphertext: "new-envelope" },
        challenge,
      }),
    ).resolves.toEqual(result);
  });
});
