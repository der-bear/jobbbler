import { describe, expect, it, vi } from "vitest";

import type { AuditEventRecord } from "@jobbbler/storage";
import { DomainError } from "@jobbbler/core-domain";

import { recordWorkerCycle, safeWorkerLogError } from "./observability.js";

describe("worker observability", () => {
  it("persists one bounded, non-identifying heartbeat with cycle metrics", async () => {
    const append = vi.fn(async (record: AuditEventRecord) => record);

    const heartbeat = await recordWorkerCycle({
      audit: { append },
      id: "audit_worker_cycle_1",
      correlationId: "cycle_550e8400-e29b-41d4-a716-446655440000",
      occurredAt: "2026-08-29T10:00:00.000Z",
      durationMs: 842,
      mode: "all_service",
      databaseDriver: "postgres",
      catalog: { claimed: 3, succeeded: 2, failed: 1, dead: 0 },
      alerts: { evaluated: 4, queued: 2, delivered: 1, failed: 1 },
    });

    expect(append).toHaveBeenCalledOnce();
    expect(heartbeat).toEqual({
      id: "audit_worker_cycle_1",
      type: "worker.cycle.completed",
      actorKind: "service",
      actorId: null,
      aggregateType: "system",
      aggregateId: "worker_cycle",
      correlationId: "cycle_550e8400-e29b-41d4-a716-446655440000",
      safeMetadata: {
        mode: "all_service",
        databaseDriver: "postgres",
        durationMs: 842,
        catalogClaimed: 3,
        catalogSucceeded: 2,
        catalogFailed: 1,
        catalogDead: 0,
        alertEvaluated: 4,
        alertQueued: 2,
        alertDelivered: 1,
        alertFailed: 1,
      },
      occurredAt: "2026-08-29T10:00:00.000Z",
    });
    expect(JSON.stringify(heartbeat)).not.toMatch(
      /databaseUrl|databasePath|email|owner|token|cookie|payload/iu,
    );
  });

  it("rejects unbounded or invalid metric values before persistence", async () => {
    const append = vi.fn();
    await expect(
      recordWorkerCycle({
        audit: { append },
        id: "audit_worker_cycle_2",
        correlationId: "cycle_550e8400-e29b-41d4-a716-446655440001",
        occurredAt: "2026-08-29T10:00:00.000Z",
        durationMs: Number.POSITIVE_INFINITY,
        mode: "all_service",
        databaseDriver: "postgres",
        catalog: null,
        alerts: null,
      }),
    ).rejects.toThrow("duration");
    expect(append).not.toHaveBeenCalled();
  });

  it("redacts operational errors down to safe typed fields", () => {
    const secret = "postgresql://person:password@example.test/private";
    expect(safeWorkerLogError(new Error(secret))).toEqual({ errorKind: "Error" });
    expect(
      safeWorkerLogError(new DomainError({ code: "DEPENDENCY", message: secret, retryable: true })),
    ).toEqual({ errorKind: "DomainError", errorCode: "DEPENDENCY", retryable: true });
  });
});
