import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { resolve } from "node:path";

import {
  createEntityId,
  DomainError,
  systemClock,
  type CommandContext,
} from "@jobbbler/core-domain";
import type { Storage } from "@jobbbler/storage";
import { createPostgresStorage, type PostgresStorage } from "@jobbbler/storage-postgres";
import { createSqliteStorage } from "@jobbbler/storage-sqlite";

interface StorageRegistration {
  readonly fingerprint: string;
  readonly storage: RuntimeStorage;
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;
export type RuntimeStorage = Storage | PostgresStorage;

const globalRegistry = globalThis as typeof globalThis & {
  __jobbblerStorage?: StorageRegistration;
};

function sqlitePath(environment: RuntimeEnvironment): string {
  const base = environment["INIT_CWD"] ?? process.cwd();
  return resolve(base, environment["SQLITE_DATABASE_PATH"] ?? ".data/jobbbler.sqlite");
}

export function createConfiguredStorage(
  environment: RuntimeEnvironment = process.env,
): RuntimeStorage {
  const databaseUrl = environment["DATABASE_URL"]?.trim();
  return databaseUrl === undefined || databaseUrl.length === 0
    ? createSqliteStorage(sqlitePath(environment))
    : createPostgresStorage(databaseUrl);
}

export function getServerStorage(): RuntimeStorage {
  const databaseUrl = process.env["DATABASE_URL"]?.trim();
  const fingerprint = createHash("sha256")
    .update(
      databaseUrl === undefined || databaseUrl.length === 0
        ? `sqlite\u0000${sqlitePath(process.env)}`
        : `postgres\u0000${databaseUrl}`,
    )
    .digest("hex");
  const existing = globalRegistry.__jobbblerStorage;
  if (existing !== undefined) {
    if (existing.fingerprint !== fingerprint) {
      throw new DomainError({
        code: "INTERNAL",
        message: "Database configuration changed while the server was running.",
      });
    }
    return existing.storage;
  }

  const storage = createConfiguredStorage();
  globalRegistry.__jobbblerStorage = { fingerprint, storage };
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
  if (environment["NODE_ENV"] === "production" && !trustProxyHeaders) {
    throw new DomainError({
      code: "DEPENDENCY",
      message: "Production rate limits require an explicitly trusted proxy boundary.",
    });
  }
  const candidate = trustProxyHeaders
    ? [
        request.headers.get("cf-connecting-ip"),
        request.headers.get("x-vercel-forwarded-for")?.split(",", 1)[0],
        request.headers.get("x-forwarded-for")?.split(",", 1)[0],
        request.headers.get("x-real-ip"),
      ]
        .map((value) => value?.trim())
        .find((value): value is string => value !== undefined && value.length > 0)
    : undefined;
  if (trustProxyHeaders && (candidate === undefined || isIP(candidate) === 0)) {
    throw new DomainError({
      code: "DEPENDENCY",
      message: "The trusted proxy did not provide a valid client address.",
    });
  }
  const client = candidate ?? "anonymous-development-client";
  const configuredSecret = environment["TOKEN_HASH_SECRET"];
  if (
    environment["NODE_ENV"] === "production" &&
    (configuredSecret === undefined || configuredSecret.length < 32)
  ) {
    throw new DomainError({
      code: "DEPENDENCY",
      message: "Production rate-limit hashing is not configured.",
    });
  }
  const secret = configuredSecret ?? "jobbbler-development-rate-limit";
  return createHash("sha256")
    .update(`${scope}\u0000${client.slice(0, 128)}\u0000${secret}`)
    .digest("hex");
}
