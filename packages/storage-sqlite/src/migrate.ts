import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { DomainError } from "@jobbbler/core-domain";

import type { SqliteDatabase } from "./connection.js";

const migrationPattern = /^(?<version>\d{4})_(?<name>[a-z0-9_]+)\.sql$/;

export interface MigrationOptions {
  readonly directory?: string;
  readonly appliedAt?: () => string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

interface MigrationFile extends AppliedMigration {
  readonly sql: string;
}

interface MigrationRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

export function defaultMigrationDirectory(): string {
  const launchDirectory = process.env["INIT_CWD"] ?? process.cwd();
  const candidates = [
    resolve(launchDirectory, "migrations/sqlite"),
    resolve(launchDirectory, "../../migrations/sqlite"),
    resolve(process.cwd(), "migrations/sqlite"),
    resolve(process.cwd(), "../../migrations/sqlite"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function readMigrations(directory: string): MigrationFile[] {
  return readdirSync(directory)
    .filter((filename) => migrationPattern.test(filename))
    .sort((left, right) => left.localeCompare(right))
    .map((filename) => {
      const match = migrationPattern.exec(filename);
      if (match?.groups === undefined) throw new Error(`Invalid migration filename: ${filename}`);
      const sql = readFileSync(join(directory, filename), "utf8");

      return {
        version: Number(match.groups["version"]),
        name: match.groups["name"] ?? "unknown",
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    });
}

function hasMigrationJournal(database: SqliteDatabase): boolean {
  const row = database
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("schema_migrations") as { readonly present: number } | undefined;
  return row?.present === 1;
}

export function migrateSqlite(
  database: SqliteDatabase,
  options: MigrationOptions = {},
): AppliedMigration[] {
  const migrations = readMigrations(options.directory ?? defaultMigrationDirectory());
  const appliedAt = options.appliedAt ?? (() => new Date().toISOString());
  const applied: AppliedMigration[] = [];

  for (const migration of migrations) {
    const existing = hasMigrationJournal(database)
      ? (database
          .prepare("SELECT version, name, checksum FROM schema_migrations WHERE version = ?")
          .get(migration.version) as MigrationRow | undefined)
      : undefined;

    if (existing !== undefined) {
      if (existing.name !== migration.name || existing.checksum !== migration.checksum) {
        throw new DomainError({
          code: "CONFLICT",
          message: `Applied SQLite migration ${String(migration.version)} does not match its source file.`,
        });
      }
      continue;
    }

    const apply = database.transaction(() => {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        )
        .run(migration.version, migration.name, migration.checksum, appliedAt());
    });
    apply.immediate();
    applied.push({
      version: migration.version,
      name: migration.name,
      checksum: migration.checksum,
    });
  }

  return applied;
}

export function verifySqliteMigrationJournal(
  database: SqliteDatabase,
  options: Pick<MigrationOptions, "directory"> = {},
): void {
  const migrations = readMigrations(options.directory ?? defaultMigrationDirectory());
  if (!hasMigrationJournal(database)) {
    throw new DomainError({ code: "CONFLICT", message: "SQLite migration journal is missing." });
  }
  const rows = database
    .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
    .all() as MigrationRow[];
  const current =
    rows.length === migrations.length &&
    rows.every((row, index) => {
      const source = migrations[index];
      return (
        source !== undefined &&
        row.version === source.version &&
        row.name === source.name &&
        row.checksum === source.checksum
      );
    });
  if (!current) {
    throw new DomainError({
      code: "CONFLICT",
      message: "SQLite migration journal is incomplete or does not match the source migrations.",
    });
  }
}
