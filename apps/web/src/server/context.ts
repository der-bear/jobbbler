import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  createEntityId,
  DomainError,
  systemClock,
  type CommandContext,
} from "@jobbbler/core-domain";
import type { Storage } from "@jobbbler/storage";
import { createSqliteStorage } from "@jobbbler/storage-sqlite";

interface StorageRegistration {
  readonly driver: "sqlite";
  readonly databasePath: string;
  readonly storage: Storage;
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const globalRegistry = globalThis as typeof globalThis & {
  __jobbblerStorage?: StorageRegistration;
};

function sqlitePath(environment: RuntimeEnvironment): string {
  const base = environment["INIT_CWD"] ?? process.cwd();
  return resolve(base, environment["SQLITE_DATABASE_PATH"] ?? ".data/jobbbler.sqlite");
}

export function createConfiguredStorage(environment: RuntimeEnvironment = process.env): Storage {
  const driver = environment["DATABASE_DRIVER"] ?? "sqlite";
  if (driver !== "sqlite") {
    throw new DomainError({
      code: "INTERNAL",
      message: "The configured database driver is unavailable.",
      retryable: false,
    });
  }
  return createSqliteStorage(sqlitePath(environment));
}

export function getServerStorage(): Storage {
  const driver = process.env["DATABASE_DRIVER"] ?? "sqlite";
  if (driver !== "sqlite") return createConfiguredStorage();
  const databasePath = sqlitePath(process.env);
  const existing = globalRegistry.__jobbblerStorage;
  if (existing !== undefined) {
    if (existing.driver !== driver || existing.databasePath !== databasePath) {
      throw new DomainError({
        code: "INTERNAL",
        message: "Database configuration changed while the server was running.",
      });
    }
    return existing.storage;
  }

  const storage = createConfiguredStorage();
  globalRegistry.__jobbblerStorage = { driver, databasePath, storage };
  return storage;
}

export function createRequestId(): string {
  return createEntityId("req");
}

export function createPublicCommandContext(requestId: string): CommandContext {
  return {
    requestId,
    correlationId: requestId,
    principal: { kind: "anonymous", roles: [] },
    clock: systemClock,
  };
}

export function getRateLimitKey(
  request: Request,
  scope: string,
  environment: RuntimeEnvironment = process.env,
): string {
  const trustProxyHeaders = environment["TRUST_PROXY_HEADERS"] === "true";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const remote = request.headers.get("x-real-ip")?.trim();
  const client = trustProxyHeaders ? forwarded || remote || "unknown-proxy-client" : "anonymous";
  const secret = environment["TOKEN_HASH_SECRET"] ?? "jobbbler-development-rate-limit";
  return createHash("sha256")
    .update(`${scope}\u0000${client.slice(0, 128)}\u0000${secret}`)
    .digest("hex");
}
