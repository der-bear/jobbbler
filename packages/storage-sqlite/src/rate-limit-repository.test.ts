import { afterEach, describe, expect, it } from "vitest";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteDatabase } from "./connection.js";
import { migrateSqlite } from "./migrate.js";
import { createSqliteRateLimitRepository } from "./rate-limit-repository.js";

describe("SQLite rate-limit persistence", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("retains a fixed window across adapter and database recreation", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-rate-limit-"));
    const filename = join(directory, "rate-limit.sqlite");
    const firstDatabase = openSqliteDatabase(filename);
    migrateSqlite(firstDatabase);
    const first = createSqliteRateLimitRepository(firstDatabase);

    await expect(
      first.check({ key: "hmac:requester", limit: 2, windowMs: 60_000, nowMs: 1_000 }),
    ).resolves.toMatchObject({ allowed: true, remaining: 1, resetAtMs: 61_000 });
    firstDatabase.close();

    const reopenedDatabase = openSqliteDatabase(filename);
    migrateSqlite(reopenedDatabase);
    const reopened = createSqliteRateLimitRepository(reopenedDatabase);
    await expect(
      reopened.check({ key: "hmac:requester", limit: 2, windowMs: 60_000, nowMs: 1_000 }),
    ).resolves.toMatchObject({ allowed: true, remaining: 0, resetAtMs: 61_000 });
    await expect(
      reopened.check({ key: "hmac:requester", limit: 2, windowMs: 60_000, nowMs: 1_000 }),
    ).resolves.toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    reopenedDatabase.close();
  });
});
