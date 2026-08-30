import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  backupSqliteDatabase,
  inspectSqliteDatabase,
  restoreAndVerifySqliteBackup,
} from "./maintenance.js";
import { openSqliteDatabase } from "./connection.js";
import { seedDemoCatalog } from "./seed.js";

const fixturePath = fileURLToPath(new URL("../../../fixtures/demo-catalog.json", import.meta.url));

describe("SQLite recovery", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("backs up, restores, and verifies the seeded catalog", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-recovery-"));
    const sourcePath = join(directory, "source.sqlite");
    const backupPath = join(directory, "backup.sqlite");
    const restoredPath = join(directory, "restored.sqlite");

    await expect(seedDemoCatalog(sourcePath, fixturePath)).resolves.toEqual({
      organizations: 12,
      jobs: 36,
    });
    const source = inspectSqliteDatabase(sourcePath);
    expect(source).toMatchObject({
      migrations: 20,
      organizations: 12,
      jobs: 36,
      searchableJobs: 36,
    });
    expect(source.canonicalChecksum).toMatch(/^[a-f0-9]{64}$/);

    await backupSqliteDatabase(sourcePath, backupPath);
    await expect(restoreAndVerifySqliteBackup(backupPath, restoredPath, source)).resolves.toEqual(
      source,
    );
  });

  it("does not overwrite an existing backup destination", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-backup-safety-"));
    const sourcePath = join(directory, "source.sqlite");
    const destinationPath = join(directory, "existing.sqlite");
    await seedDemoCatalog(sourcePath, fixturePath);
    await writeFile(destinationPath, "keep this file", "utf8");

    await expect(backupSqliteDatabase(sourcePath, destinationPath)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(readFile(destinationPath, "utf8")).resolves.toBe("keep this file");
  });

  it("detects same-ID content changes in a restore candidate", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-backup-tamper-"));
    const sourcePath = join(directory, "source.sqlite");
    const tamperedBackupPath = join(directory, "tampered.sqlite");
    const restoredPath = join(directory, "restored.sqlite");
    await seedDemoCatalog(sourcePath, fixturePath);
    const expected = inspectSqliteDatabase(sourcePath);
    await backupSqliteDatabase(sourcePath, tamperedBackupPath);

    const tampered = openSqliteDatabase(tamperedBackupPath);
    tampered
      .prepare("UPDATE jobs SET title = ? WHERE id = ?")
      .run("Unexpected modified title", "job_00000001-0000-7000-8000-000000000001");
    tampered.close();

    await expect(
      restoreAndVerifySqliteBackup(tamperedBackupPath, restoredPath, expected),
    ).rejects.toThrow("does not match");
  });
});
