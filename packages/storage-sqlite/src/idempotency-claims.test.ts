import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IdempotencyRecord } from "@jobbbler/storage";

import { createSqliteStorage } from "./storage.js";

describe("SQLite idempotency claims", () => {
  it("does not let a stale same-hash lease delete a newer claim body", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-idempotency-claims-"));
    const storage = createSqliteStorage(join(directory, "jobbbler.sqlite"));
    const record: IdempotencyRecord = {
      scope: "search_alert.request_claim:owner-1",
      key: "client-request-1",
      requestHash: "a".repeat(64),
      responseStatus: 202,
      responseBody: { status: "preparing", claimId: "old-claim" },
      createdAt: "2026-08-30T09:00:00.000Z",
      expiresAt: "2026-08-30T09:05:00.000Z",
    };

    await storage.idempotency.putIfAbsent(record);

    await expect(
      storage.idempotency.deleteExact({ ...record, requestHash: "b".repeat(64) }),
    ).resolves.toBe(false);
    await expect(storage.idempotency.get(record.scope, record.key)).resolves.toEqual(record);
    await expect(storage.idempotency.deleteExact(record)).resolves.toBe(true);
    await expect(storage.idempotency.get(record.scope, record.key)).resolves.toBeNull();

    const fresh = { ...record, responseBody: { status: "preparing", claimId: "fresh-claim" } };
    await storage.idempotency.putIfAbsent(fresh);
    await expect(storage.idempotency.deleteExact(record)).resolves.toBe(false);
    await expect(storage.idempotency.get(record.scope, record.key)).resolves.toEqual(fresh);

    storage.close();
    await rm(directory, { recursive: true });
  });
});
