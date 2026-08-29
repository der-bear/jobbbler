import { resolve } from "node:path";

import { DomainError } from "@jobbbler/core-domain";
import type { Storage } from "@jobbbler/storage";
import { createPostgresStorage, type PostgresStorage } from "@jobbbler/storage-postgres";
import { createSqliteStorage } from "@jobbbler/storage-sqlite";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;
export type WorkerStorage = Storage | PostgresStorage;

export interface ConfiguredWorkerStorage {
  readonly driver: "sqlite" | "postgres";
  readonly databasePath: string | null;
  readonly storage: WorkerStorage;
}

export function createConfiguredWorkerStorage(
  environment: RuntimeEnvironment = process.env,
): ConfiguredWorkerStorage {
  const databaseUrl = environment["DATABASE_URL"]?.trim();
  if (databaseUrl !== undefined && databaseUrl.length > 0) {
    try {
      const parsed = new URL(databaseUrl);
      if (
        (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
        parsed.hostname.length === 0 ||
        parsed.pathname.length < 2
      ) {
        throw new Error("invalid database URL");
      }
    } catch {
      throw new DomainError({
        code: "DEPENDENCY",
        message: "The worker DATABASE_URL must identify a PostgreSQL database.",
      });
    }
    return {
      driver: "postgres",
      databasePath: null,
      storage: createPostgresStorage(databaseUrl),
    };
  }

  if (environment["NODE_ENV"] === "production") {
    throw new DomainError({
      code: "DEPENDENCY",
      message: "The production worker requires PostgreSQL storage.",
    });
  }

  const base = environment["INIT_CWD"] ?? process.cwd();
  const databasePath = resolve(
    base,
    environment["SQLITE_DATABASE_PATH"] ?? ".data/jobbbler.sqlite",
  );
  return {
    driver: "sqlite",
    databasePath,
    storage: createSqliteStorage(databasePath),
  };
}
