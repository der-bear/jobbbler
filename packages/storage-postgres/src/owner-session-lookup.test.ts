import { describe, expect, it, vi } from "vitest";

import type { OwnerSessionRecord } from "@jobbbler/core-domain";

import type { PostgresExecutor } from "./connection.js";
import { findOwnerSessionByTokenHash } from "./storage.js";

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
});
