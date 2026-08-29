import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  backupSqliteDatabase,
  inspectSqliteDatabase,
  restoreAndVerifySqliteBackup,
} from "../packages/storage-sqlite/src/maintenance.js";

const sourcePath = resolve(
  process.argv[2] ?? process.env["SQLITE_DATABASE_PATH"] ?? ".data/jobbbler.sqlite",
);
const directory = await mkdtemp(join(tmpdir(), "jobbbler-restore-verify-"));

try {
  const backupPath = join(directory, "backup.sqlite");
  const restoredPath = join(directory, "restored.sqlite");
  const expected = inspectSqliteDatabase(sourcePath);
  await backupSqliteDatabase(sourcePath, backupPath);
  const restored = await restoreAndVerifySqliteBackup(backupPath, restoredPath, expected);
  process.stdout.write(
    `Verified SQLite restore: ${String(restored.jobs)} jobs, checksum ${restored.canonicalChecksum}\n`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
