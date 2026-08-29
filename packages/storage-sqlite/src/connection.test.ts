import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteDatabase } from "./connection.js";

describe("openSqliteDatabase", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("enables foreign keys, WAL, and the busy timeout", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-sqlite-settings-"));
    const database = openSqliteDatabase(join(directory, "settings.sqlite"));

    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.pragma("busy_timeout", { simple: true })).toBe(5_000);

    database.close();
  });
});
