import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import type { PostgresSql } from "./connection.js";

const migrationPattern = /^(?<version>\d{4})_(?<name>[a-z0-9_]+)\.sql$/;

export interface PostgresMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly sql: string;
}

export function resolvePostgresMigrationDirectory(
  moduleUrl: string,
  workingDirectory: string,
): string {
  const candidates = [
    resolve(dirname(fileURLToPath(moduleUrl)), "../../../migrations/postgres"),
    resolve(workingDirectory, "migrations/postgres"),
    resolve(workingDirectory, "../../migrations/postgres"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[1]!;
}

export function defaultPostgresMigrationDirectory(): string {
  return resolvePostgresMigrationDirectory(import.meta.url, process.cwd());
}

export function postgresMigrationManifest(
  directory = defaultPostgresMigrationDirectory(),
): PostgresMigration[] {
  return readdirSync(directory)
    .filter((filename) => migrationPattern.test(filename))
    .sort((left, right) => left.localeCompare(right))
    .map((filename) => {
      const match = migrationPattern.exec(filename);
      if (match?.groups === undefined)
        throw new Error(`Invalid PostgreSQL migration filename: ${filename}`);
      const sql = readFileSync(join(directory, filename), "utf8");
      return {
        version: Number(match.groups["version"]),
        name: match.groups["name"] ?? "unknown",
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    });
}

export async function migratePostgres(
  sql: PostgresSql,
  directory = defaultPostgresMigrationDirectory(),
): Promise<readonly PostgresMigration[]> {
  const migrations = postgresMigrationManifest(directory);
  await sql.unsafe("CREATE SCHEMA IF NOT EXISTS jobbbler");
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS jobbbler.schema_migrations (
    version integer PRIMARY KEY, name text NOT NULL UNIQUE, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied: PostgresMigration[] = [];
  for (const migration of migrations) {
    await sql.begin(async (transaction) => {
      const existing = await transaction<{ readonly name: string; readonly checksum: string }[]>`
        SELECT name, checksum FROM jobbbler.schema_migrations WHERE version = ${migration.version}`;
      if (existing[0] !== undefined) {
        if (existing[0].name !== migration.name || existing[0].checksum !== migration.checksum) {
          throw new Error(
            `Applied PostgreSQL migration ${migration.version} does not match its source file.`,
          );
        }
        return;
      }
      await transaction.unsafe(migration.sql);
      await transaction`INSERT INTO jobbbler.schema_migrations(version, name, checksum) VALUES (${migration.version}, ${migration.name}, ${migration.checksum})`;
      applied.push(migration);
    });
  }
  return applied;
}

/** Test-only destructive reset; never call this from production scripts. */
export async function resetPostgresSchema(sql: PostgresSql): Promise<void> {
  await sql.unsafe("DROP SCHEMA IF EXISTS jobbbler CASCADE");
}
