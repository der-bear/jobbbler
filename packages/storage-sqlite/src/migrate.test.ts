import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteDatabase } from "./connection.js";
import { migrateSqlite } from "./migrate.js";

describe("migrateSqlite", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("applies every migration once", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-migrations-"));
    const database = openSqliteDatabase(join(directory, "migrations.sqlite"));

    const applied = migrateSqlite(database);
    expect(applied).toContainEqual(
      expect.objectContaining({ version: 21, name: "job_search_document" }),
    );
    expect(migrateSqlite(database)).toEqual([]);
    expect(database.prepare("SELECT count(*) AS count FROM schema_migrations").get()).toEqual({
      count: applied.length,
    });

    database.close();
  });

  it("rejects migration journal drift", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-migration-drift-"));
    const database = openSqliteDatabase(join(directory, "drift.sqlite"));
    migrateSqlite(database);
    database
      .prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 3")
      .run("0".repeat(64));

    expect(() => migrateSqlite(database)).toThrowError(
      expect.objectContaining({ code: "CONFLICT" }),
    );

    database.close();
  });
});
