import { describe, expect, it, vi } from "vitest";

import type { OwnerSessionRecord } from "@jobbbler/core-domain";

import type { PostgresExecutor, PostgresSql } from "./connection.js";
import { findOwnerSessionByTokenHash, resolveOwnerSession } from "./storage.js";

const session: OwnerSessionRecord = {
  id: "owner_session_550e8400-e29b-41d4-a716-446655440000",
  ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
  tokenHash: "a".repeat(64),
  status: "active",
  expiresAt: "2026-09-29T10:00:00.000Z",
  lastSeenAt: "2026-08-29T10:00:00.000Z",
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
};

describe("findOwnerSessionByTokenHash", () => {
  it("uses the indexed token expression instead of loading every owner session", async () => {
    const query = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      expect(strings.join("?")).toContain("body->>'tokenHash' = ?");
      expect(strings.join("?")).toContain("LIMIT 1");
      expect(values).toEqual([session.tokenHash]);
      return [{ id: session.id, owner_id: session.ownerId, body: session, version: 0 }];
    });

    await expect(
      findOwnerSessionByTokenHash(query as unknown as PostgresExecutor, session.tokenHash),
    ).resolves.toEqual(session);
    expect(query).toHaveBeenCalledOnce();
  });

  it("cannot refresh a session that recovery revoked after the initial lookup", async () => {
    const owner = {
      id: session.ownerId,
      kind: "guest" as const,
      verified: true,
      version: 0,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
    let storedSession: OwnerSessionRecord = session;
    let writes = 0;
    const query = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const statement = strings.join("?");
      if (statement.includes("body->>'tokenHash' = ?")) {
        expect(values).toEqual([session.tokenHash]);
        return [{ id: session.id, owner_id: session.ownerId, body: session, version: 0 }];
      }
      if (statement.includes("kind = ?") && statement.includes("id = ? FOR UPDATE")) {
        if (values[0] === "owner") {
          storedSession = {
            ...storedSession,
            status: "revoked",
            updatedAt: "2026-08-29T10:05:00.000Z",
          };
          return [{ id: owner.id, owner_id: owner.id, body: owner, version: owner.version }];
        }
        if (values[0] === "owner_session") {
          return [
            {
              id: storedSession.id,
              owner_id: storedSession.ownerId,
              body: storedSession,
              version: 0,
            },
          ];
        }
      }
      if (statement.includes("INSERT INTO jobbbler.entity_records")) writes += 1;
      return [];
    });
    const sql = Object.assign(query, {
      begin: vi.fn(async (callback: (transaction: PostgresExecutor) => Promise<unknown>) =>
        callback(query as unknown as PostgresExecutor),
      ),
    });

    await expect(
      resolveOwnerSession(
        sql as unknown as PostgresSql,
        session.tokenHash,
        "2026-08-29T10:06:00.000Z",
      ),
    ).resolves.toBeNull();
    expect(writes).toBe(0);
    expect(sql.begin).toHaveBeenCalledOnce();
  });
});
