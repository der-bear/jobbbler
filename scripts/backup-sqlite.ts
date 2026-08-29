import { resolve } from "node:path";

import { backupSqliteDatabase } from "../packages/storage-sqlite/src/maintenance.js";

const sourcePath = resolve(
  process.argv[2] ?? process.env["SQLITE_DATABASE_PATH"] ?? ".data/jobbbler.sqlite",
);
const timestamp = new Date().toISOString().replaceAll(":", "-");
const destinationPath = resolve(process.argv[3] ?? `.data/backups/jobbbler-${timestamp}.sqlite`);

await backupSqliteDatabase(sourcePath, destinationPath);
process.stdout.write(`Created a consistent SQLite backup: ${destinationPath}\n`);
