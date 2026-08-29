import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createConfiguredStorage, createPublicCommandContext, getRateLimitKey } from "./context";

const temporaryDirectories: string[] = [];

describe("web server context", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("opens the configured SQLite adapter without leaking it into domain commands", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-web-context-"));
    temporaryDirectories.push(directory);
    const storage = createConfiguredStorage({
      SQLITE_DATABASE_PATH: join(directory, "jobbbler.sqlite"),
    });

    await expect(storage.jobs.listAll()).resolves.toEqual([]);
    storage.close();
  });

  it("selects the PostgreSQL adapter when a server-only database URL is present", async () => {
    const storage = createConfiguredStorage({
      DATABASE_URL: "postgres://jobbbler:secret@localhost:5432/jobbbler",
    });

    expect(storage).toHaveProperty("sql");
    await storage.close();
  });

  it("creates a public read context with one correlation boundary", () => {
    const requestId = "req_550e8400-e29b-41d4-a716-446655440000";
    expect(createPublicCommandContext(requestId)).toMatchObject({
      requestId,
      correlationId: requestId,
      principal: { kind: "anonymous", roles: [] },
    });
  });

  it("does not trust spoofable forwarding headers without an explicit proxy boundary", () => {
    const firstRequest = new Request("https://jobbbler.example/api", {
      headers: { "x-forwarded-for": "203.0.113.24", "user-agent": "test-client" },
    });
    const secondRequest = new Request("https://jobbbler.example/api", {
      headers: { "x-forwarded-for": "198.51.100.42", "user-agent": "other-client" },
    });
    const first = getRateLimitKey(firstRequest, "search", {
      TOKEN_HASH_SECRET: "test-secret",
    });

    expect(first).toHaveLength(64);
    expect(first).not.toContain("203.0.113.24");
    expect(getRateLimitKey(secondRequest, "search", { TOKEN_HASH_SECRET: "test-secret" })).toBe(
      first,
    );
    expect(getRateLimitKey(firstRequest, "detail", { TOKEN_HASH_SECRET: "test-secret" })).not.toBe(
      first,
    );
  });

  it("uses a forwarded client address only behind an explicitly trusted proxy", () => {
    const first = new Request("https://jobbbler.example/api", {
      headers: { "x-forwarded-for": "203.0.113.24" },
    });
    const second = new Request("https://jobbbler.example/api", {
      headers: { "x-forwarded-for": "198.51.100.42" },
    });
    const environment = {
      TRUST_PROXY_HEADERS: "true",
      TOKEN_HASH_SECRET: "test-secret",
    };

    expect(getRateLimitKey(first, "search", environment)).not.toBe(
      getRateLimitKey(second, "search", environment),
    );
  });

  it("fails closed when a production rate-limit boundary has no trusted client address", () => {
    const request = new Request("https://jobbbler.example/api");

    expect(() =>
      getRateLimitKey(request, "identity-session", {
        NODE_ENV: "production",
        TOKEN_HASH_SECRET: "test-secret-that-is-at-least-32-bytes",
      }),
    ).toThrow("trusted proxy");
    expect(() =>
      getRateLimitKey(request, "identity-session", {
        NODE_ENV: "production",
        TRUST_PROXY_HEADERS: "true",
        TOKEN_HASH_SECRET: "test-secret-that-is-at-least-32-bytes",
      }),
    ).toThrow("client address");
  });

  it("accepts provider-specific addresses only across the explicit production proxy boundary", () => {
    const request = new Request("https://jobbbler.example/api", {
      headers: { "cf-connecting-ip": "203.0.113.24" },
    });

    expect(
      getRateLimitKey(request, "identity-session", {
        NODE_ENV: "production",
        TRUST_PROXY_HEADERS: "true",
        TOKEN_HASH_SECRET: "test-secret-that-is-at-least-32-bytes",
      }),
    ).toHaveLength(64);
  });
});
