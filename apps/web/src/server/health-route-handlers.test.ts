import { describe, expect, it } from "vitest";

import {
  assertFreshWorkerHeartbeat,
  handleLiveHealthRequest,
  handleReadyHealthRequest,
  validatePostgresMigrationJournal,
} from "./health-route-handlers";

describe("health route handlers", () => {
  it("returns a non-secret liveness response", async () => {
    const response = await handleLiveHealthRequest();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { status: "live" } });
  });

  it("returns a safe readiness summary", async () => {
    const response = await handleReadyHealthRequest({
      inspect: () => ({
        driver: "sqlite",
        migrations: 12,
        organizations: 2,
        jobs: 3,
        searchableJobs: 3,
        canonicalChecksum: "secret",
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      status: "ready",
      driver: "sqlite",
      migrations: 12,
      organizations: 2,
      jobs: 3,
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("reports PostgreSQL readiness without returning connection data", async () => {
    const response = await handleReadyHealthRequest({
      inspect: async () => ({ driver: "postgres", migrations: 8, organizations: 4, jobs: 9 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { status: "ready", driver: "postgres", migrations: 8, organizations: 4, jobs: 9 },
    });
  });

  it("rejects an incomplete or tampered PostgreSQL migration journal", () => {
    const expected = [
      { version: 1, name: "core", checksum: "a".repeat(64) },
      { version: 2, name: "search", checksum: "b".repeat(64) },
    ];

    expect(() => validatePostgresMigrationJournal(expected, expected)).not.toThrow();
    expect(() => validatePostgresMigrationJournal(expected.slice(0, 1), expected)).toThrow(
      "incomplete",
    );
    expect(() =>
      validatePostgresMigrationJournal(
        [expected[0]!, { ...expected[1]!, checksum: "c".repeat(64) }],
        expected,
      ),
    ).toThrow("incomplete");
  });

  it("returns 503 when readiness inspection fails", async () => {
    const response = await handleReadyHealthRequest({
      inspect: () => {
        throw new Error("broken migration journal");
      },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        code: "DEPENDENCY",
        message: "Production dependencies are not ready.",
        retryable: true,
        details: { phase: "inspection" },
      },
    });
  });

  it("rejects a missing or stale production worker heartbeat", () => {
    const now = "2026-08-29T10:15:00.000Z";
    expect(() => assertFreshWorkerHeartbeat("2026-08-29T10:05:01.000Z", now, 600)).not.toThrow();
    expect(() => assertFreshWorkerHeartbeat(null, now, 600)).toThrow("heartbeat");
    expect(() => assertFreshWorkerHeartbeat("2026-08-29T10:04:59.999Z", now, 600)).toThrow("stale");
  });
});
