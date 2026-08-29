import { afterEach, describe, expect, it } from "vitest";

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { seedDemoCatalog } from "../packages/storage-sqlite/src/seed.js";
import { exportSqliteSnapshot } from "./export-sqlite.js";
import { parseSnapshot } from "./import-postgres.js";

interface SnapshotLine {
  readonly type: "manifest" | "row";
  readonly table?: string;
}

describe("SQLite snapshot export", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("is deterministic and includes a checksum-bound manifest", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-export-"));
    const database = join(directory, "catalog.sqlite");
    const fixture = fileURLToPath(new URL("../fixtures/demo-catalog.json", import.meta.url));
    await seedDemoCatalog(database, fixture);

    const firstPath = join(directory, "first.ndjson");
    const secondPath = join(directory, "second.ndjson");
    const first = await exportSqliteSnapshot(database, firstPath);
    const second = await exportSqliteSnapshot(database, secondPath);

    expect(second).toEqual(first);
    await expect(readFile(secondPath, "utf8")).resolves.toEqual(await readFile(firstPath, "utf8"));
    expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(first.rowCount).toBeGreaterThan(0);
    expect(first.formatVersion).toBe(2);
    expect(first.sqliteSchemaVersion).toBe(20);
    expect(first.tableModes["alert_evaluation_baselines"]).toBe("aggregate");
    expect(first.tableModes["owner_activity_events"]).toBe("relational");
    expect(first.tableModes["application_reviews"]).toBe("staged_only");
  });

  it("excludes SQLite journals, virtual tables, and every FTS shadow table", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-export-internals-"));
    const database = join(directory, "catalog.sqlite");
    const fixture = fileURLToPath(new URL("../fixtures/demo-catalog.json", import.meta.url));
    await seedDemoCatalog(database, fixture);

    const snapshotPath = join(directory, "snapshot.ndjson");
    const manifest = await exportSqliteSnapshot(database, snapshotPath);
    const lines = (await readFile(snapshotPath, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as SnapshotLine);
    const rowTables = new Set(lines.slice(1).map((line) => line.table));

    expect(Object.keys(manifest.tables)).not.toContain("schema_migrations");
    expect([...rowTables]).not.toContain("jobs_fts");
    expect([...rowTables].filter((table) => table?.startsWith("jobs_fts_"))).toEqual([]);
    expect([...rowTables].filter((table) => table?.startsWith("sqlite_"))).toEqual([]);
  });

  it("binds manifest metadata and table counts to the snapshot checksum", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-export-manifest-"));
    const database = join(directory, "catalog.sqlite");
    const fixture = fileURLToPath(new URL("../fixtures/demo-catalog.json", import.meta.url));
    await seedDemoCatalog(database, fixture);

    const snapshotPath = join(directory, "snapshot.ndjson");
    await exportSqliteSnapshot(database, snapshotPath);
    const lines = (await readFile(snapshotPath, "utf8")).trimEnd().split("\n");
    const manifest = JSON.parse(lines[0] ?? "{}") as {
      tables: Record<string, number>;
    };
    manifest.tables["jobs"] = (manifest.tables["jobs"] ?? 0) + 1;
    lines[0] = JSON.stringify(manifest);

    expect(() => parseSnapshot(`${lines.join("\n")}\n`)).toThrow(/checksum|table counts/i);
  });
});
