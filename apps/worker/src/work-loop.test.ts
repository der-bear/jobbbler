import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DomainError } from "@jobbbler/core-domain";
import { createSqliteStorage } from "@jobbbler/storage-sqlite";

import { runWorkBatch } from "./work-loop.js";

const now = "2026-08-29T10:00:00.000Z";
const temporaryDirectories: string[] = [];

describe("lease-based work loop", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("isolates handler failures and reschedules them with bounded backoff", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-work-loop-"));
    temporaryDirectories.push(directory);
    const storage = createSqliteStorage(join(directory, "jobbbler.sqlite"));
    for (const [id, source] of [
      ["work_success", "jobicy"],
      ["work_retry", "remoteok"],
    ] as const) {
      await storage.workItems.insert({
        id,
        kind: "catalog_ingest",
        payload: { source },
        status: "pending",
        availableAt: now,
        attempt: 0,
        maxAttempts: 3,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    const result = await runWorkBatch({
      storage,
      workerId: "worker-a",
      now,
      leaseSeconds: 120,
      limit: 10,
      signal: new AbortController().signal,
      random: () => 0.5,
      handle: async (item) => {
        if (item.id === "work_retry") {
          throw new DomainError({
            code: "DEPENDENCY",
            message: "Synthetic upstream failure.",
            retryable: true,
          });
        }
      },
    });

    expect(result).toEqual({ claimed: 2, succeeded: 1, failed: 1, dead: 0 });
    await expect(storage.workItems.getById("work_success")).resolves.toMatchObject({
      status: "succeeded",
      leaseOwner: null,
    });
    await expect(storage.workItems.getById("work_retry")).resolves.toMatchObject({
      status: "failed",
      availableAt: "2026-08-29T10:00:30.000Z",
      attempt: 1,
      lastErrorCode: "DEPENDENCY",
    });
    storage.close();
  });

  it("renews a lease while a handler remains active", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-work-loop-renew-"));
    temporaryDirectories.push(directory);
    const storage = createSqliteStorage(join(directory, "jobbbler.sqlite"));
    await storage.workItems.insert({
      id: "work_renew",
      kind: "catalog_ingest",
      payload: { source: "jobicy" },
      status: "pending",
      availableAt: now,
      attempt: 0,
      maxAttempts: 3,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    let leaseExpiresAt: string | null = null;

    await runWorkBatch({
      storage,
      workerId: "worker-a",
      now,
      leaseSeconds: 1,
      limit: 1,
      signal: new AbortController().signal,
      handle: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 650));
        leaseExpiresAt = (await storage.workItems.getById("work_renew"))?.leaseExpiresAt ?? null;
      },
    });

    expect(Date.parse(leaseExpiresAt ?? "")).toBeGreaterThan(
      Date.parse("2026-08-29T10:00:01.000Z"),
    );
    storage.close();
  });
});
