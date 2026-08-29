import { resolve } from "node:path";

import { openSqliteDatabase } from "../packages/storage-sqlite/src/connection.js";
import { migrateSqlite } from "../packages/storage-sqlite/src/migrate.js";

const databasePath = resolve(
  process.argv[2] ?? process.env["SQLITE_DATABASE_PATH"] ?? ".data/jobbbler.sqlite",
);
const database = openSqliteDatabase(databasePath);

try {
  const applied = migrateSqlite(database);
  process.stdout.write(
    `${applied.length === 0 ? "SQLite schema is current" : `Applied ${String(applied.length)} SQLite migrations`}: ${databasePath}\n`,
  );
} finally {
  database.close();
}
