import { describe, expect, it } from "vitest";

import * as verifier from "./verify-migration.js";

const at = "2026-08-29T10:00:00.000Z";

const manifest = {
  type: "manifest" as const,
  formatVersion: 2,
  sqliteSchemaVersion: 14,
  checksum: "a".repeat(64),
  rowCount: 3,
  tables: { owners: 1, jobs: 1, owner_activity_events: 1 },
  tableModes: {},
};

const plan = {
  entities: [
    {
      kind: "owner",
      id: "owner_1",
      ownerId: "owner_1",
      body: {
        id: "owner_1",
        kind: "guest",
        verified: true,
        version: 1,
        createdAt: at,
        updatedAt: at,
      },
      version: 1,
      createdAt: at,
      updatedAt: at,
    },
    {
      kind: "job",
      id: "job_1",
      ownerId: null,
      body: { id: "job_1", title: "Platform Engineer" },
      version: 0,
      createdAt: at,
      updatedAt: at,
    },
  ],
  ownerActivities: [
    {
      sequence: 7,
      id: "activity_1",
      ownerId: "owner_1",
      schemaVersion: 1,
      kind: "application",
      activityKey: "application.submitted",
      status: "completed",
      safeSummary: "Application submitted",
      correlationId: "correlation_1",
      actorKind: "agent",
      aggregateType: "application_draft",
      aggregateVersion: 4,
      occurredAt: at,
      effects: [],
    },
  ],
  rateLimitWindows: [],
  stagedOnlyTables: [],
  entityCounts: { owner: 1, job: 1 },
};

const evidence = {
  snapshot: { formatVersion: 2, checksum: "a".repeat(64), rowCount: 3, status: "imported" },
  stagedCounts: { owners: 1, jobs: 1, owner_activity_events: 1 },
  entities: plan.entities,
  ownerActivities: plan.ownerActivities,
  rateLimitWindows: [],
  searchDocumentJobIds: ["job_1"],
  representativeSearchMatched: true,
  representativeOwner: {
    ownerId: "owner_1",
    entityIdentities: ["owner\u0000owner_1"],
    activityIds: ["activity_1"],
  },
};

describe("PostgreSQL migration verification", () => {
  it("accepts exact staged, entity, search, and owner-private continuity evidence", () => {
    const assertEvidence = (verifier as Record<string, unknown>)["assertPostgresSnapshotEvidence"];
    expect(assertEvidence).toBeTypeOf("function");
    if (typeof assertEvidence !== "function") return;
    expect(() => assertEvidence(manifest, plan, evidence)).not.toThrow();
  });

  it("rejects missing imported entity IDs even when staging counts match", () => {
    const assertEvidence = (verifier as Record<string, unknown>)["assertPostgresSnapshotEvidence"];
    expect(assertEvidence).toBeTypeOf("function");
    if (typeof assertEvidence !== "function") return;
    expect(() =>
      assertEvidence(manifest, plan, { ...evidence, entities: evidence.entities.slice(0, 1) }),
    ).toThrow(/entity identities/i);
  });

  it("rejects a catalog whose representative full-text search no longer resolves", () => {
    const assertEvidence = (verifier as Record<string, unknown>)["assertPostgresSnapshotEvidence"];
    expect(assertEvidence).toBeTypeOf("function");
    if (typeof assertEvidence !== "function") return;
    expect(() =>
      assertEvidence(manifest, plan, { ...evidence, representativeSearchMatched: false }),
    ).toThrow(/catalog search/i);
  });

  it("rejects missing owner-private records or activity history", () => {
    const assertEvidence = (verifier as Record<string, unknown>)["assertPostgresSnapshotEvidence"];
    expect(assertEvidence).toBeTypeOf("function");
    if (typeof assertEvidence !== "function") return;
    expect(() =>
      assertEvidence(manifest, plan, {
        ...evidence,
        representativeOwner: { ownerId: "owner_1", entityIdentities: [], activityIds: [] },
      }),
    ).toThrow(/owner-private continuity/i);
  });
});
