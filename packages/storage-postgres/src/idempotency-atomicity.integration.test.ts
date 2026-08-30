import { afterEach, describe, expect, it } from "vitest";

import type { IdempotencyRecord } from "@jobbbler/storage";

import { createPostgresStorage, migratePostgres, resetPostgresSchema } from "./index.js";

const databaseUrl = process.env["POSTGRES_TEST_DATABASE_URL"];

function record(key: string, requestHash: string): IdempotencyRecord {
  return {
    scope: "search_alert.decision_claim:owner-1",
    key,
    requestHash,
    responseStatus: 202,
    responseBody: { status: "deciding" },
    createdAt: "2026-08-30T09:00:00.000Z",
    expiresAt: "2026-08-30T09:05:00.000Z",
  };
}

describe.skipIf(databaseUrl === undefined)("PostgreSQL idempotency atomicity", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("elects one winner for concurrent equal and conflicting claims", async () => {
    const storage = createPostgresStorage(databaseUrl!);
    close = () => storage.close();
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);

    const equal = record("equal-key", "a".repeat(64));
    const equalResults = await Promise.all([
      storage.idempotency.putIfAbsent(equal),
      storage.idempotency.putIfAbsent(equal),
    ]);
    expect(equalResults.map(({ inserted }) => inserted).sort()).toEqual([false, true]);

    const conflicting = await Promise.allSettled([
      storage.idempotency.putIfAbsent(record("conflicting-key", "b".repeat(64))),
      storage.idempotency.putIfAbsent(record("conflicting-key", "c".repeat(64))),
    ]);
    expect(conflicting.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(conflicting.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(
      conflicting.find((result): result is PromiseRejectedResult => result.status === "rejected")
        ?.reason,
    ).toMatchObject({ code: "CONFLICT" });
  });
});
