import { describe, expect, it, vi } from "vitest";

import type { IdempotencyRecord } from "@jobbbler/storage";

import type { PostgresSql } from "./connection.js";

const postgres = vi.hoisted(() => ({ sql: undefined as unknown }));

vi.mock("./connection.js", () => ({
  openPostgresDatabase: () => postgres.sql,
}));

import { createPostgresStorage } from "./storage.js";

const record: IdempotencyRecord = {
  scope: "search_alert.decision_claim:owner-1",
  key: "request-1",
  requestHash: "a".repeat(64),
  responseStatus: 202,
  responseBody: { status: "preparing" },
  createdAt: "2026-08-30T09:00:00.000Z",
  expiresAt: "2026-08-31T09:00:00.000Z",
};

describe("PostgreSQL idempotency claims", () => {
  it("claims the key with one atomic insert before reading the winner", async () => {
    let stored: (IdempotencyRecord & { readonly id: string }) | null = null;
    const query = Object.assign(
      vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const statement = strings.join("?").replaceAll(/\s+/g, " ").trim();
        if (statement.startsWith("INSERT INTO jobbbler.entity_records")) {
          expect(statement).toContain("ON CONFLICT (kind, id) DO NOTHING");
          expect(statement).toContain("RETURNING id, owner_id, body, version");
          const candidate = values.find(
            (value): value is IdempotencyRecord & { readonly id: string } =>
              typeof value === "object" &&
              value !== null &&
              "scope" in value &&
              "requestHash" in value &&
              "id" in value,
          );
          expect(candidate).toBeDefined();
          if (stored !== null) return [];
          stored = candidate ?? null;
          return [{ id: candidate?.id, owner_id: null, body: candidate, version: 0 }];
        }
        if (statement.startsWith("SELECT id, owner_id, body, version")) {
          if (query.mock.calls.length === 1 && stored === null) {
            throw new Error("idempotency was read before it was claimed");
          }
          if (stored === null) return [];
          return [{ id: stored.id, owner_id: null, body: stored, version: 0 }];
        }
        if (statement.startsWith("DELETE FROM jobbbler.entity_records")) {
          expect(statement).toContain("body->>'requestHash'");
          expect(statement).toContain("body->'responseBody'");
          const requestHash = values.at(-2);
          const responseBody = values.at(-1);
          if (
            stored === null ||
            stored.requestHash !== requestHash ||
            JSON.stringify(stored.responseBody) !== JSON.stringify(responseBody)
          ) {
            return [];
          }
          const deleted = stored;
          stored = null;
          return [{ id: deleted.id }];
        }
        throw new Error(`Unexpected SQL: ${statement}`);
      }),
      {
        array: vi.fn((items: readonly unknown[]) => items),
        json: vi.fn((value: unknown) => value),
        end: vi.fn(),
      },
    );
    postgres.sql = query as unknown as PostgresSql;
    const storage = createPostgresStorage("postgresql://unused.test/jobbbler");

    await expect(storage.idempotency.putIfAbsent(record)).resolves.toEqual({
      inserted: true,
      record,
    });
    await expect(storage.idempotency.putIfAbsent(record)).resolves.toEqual({
      inserted: false,
      record,
    });
    await expect(
      storage.idempotency.putIfAbsent({ ...record, requestHash: "b".repeat(64) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      storage.idempotency.deleteExact({ ...record, requestHash: "b".repeat(64) }),
    ).resolves.toBe(false);
    await expect(storage.idempotency.deleteExact(record)).resolves.toBe(true);
    await expect(storage.idempotency.get(record.scope, record.key)).resolves.toBeNull();

    expect(query.mock.calls[0]?.[0].join(" ")).toContain("INSERT INTO jobbbler.entity_records");
  });
});
