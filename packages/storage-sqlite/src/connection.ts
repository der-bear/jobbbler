import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

export type SqliteDatabase = Database.Database;

export function openSqliteDatabase(filename: string): SqliteDatabase {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });

  const database = new Database(filename);

  try {
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    const journalMode = database.pragma("journal_mode = WAL", { simple: true });
    database.pragma("synchronous = NORMAL");

    if (database.pragma("foreign_keys", { simple: true }) !== 1) {
      throw new Error("SQLite foreign-key enforcement could not be enabled.");
    }
    if (journalMode !== "wal") throw new Error("SQLite WAL mode could not be enabled.");
    if (database.pragma("busy_timeout", { simple: true }) !== 5_000) {
      throw new Error("SQLite busy timeout could not be configured.");
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
