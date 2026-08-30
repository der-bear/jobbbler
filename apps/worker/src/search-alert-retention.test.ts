import { describe, expect, it, vi } from "vitest";

import { runSearchAlertRetention } from "./search-alert-retention.js";

describe("search alert retention", () => {
  it("purges one bounded lifecycle batch before unrelated alert idempotency", async () => {
    const purgeExpiredPreparations = vi.fn(async () => 7);
    const purgeExpired = vi.fn(async () => 5);

    await expect(
      runSearchAlertRetention(
        { purgeExpired: purgeExpiredPreparations },
        { purgeExpired },
        {
          now: "2026-08-30T09:30:00.000Z",
          limit: 100,
        },
      ),
    ).resolves.toEqual({
      purgedPreparations: 7,
      purgedIdempotency: 5,
      failed: [],
    });

    expect(purgeExpiredPreparations).toHaveBeenCalledWith({
      now: "2026-08-30T09:30:00.000Z",
      limit: 100,
    });
    expect(purgeExpired).toHaveBeenCalledWith({
      scopePrefix: "search_alert.",
      now: "2026-08-30T09:30:00.000Z",
      limit: 100,
    });
  });

  it("isolates maintenance failures so sibling cleanup and the worker cycle can continue", async () => {
    const purgeExpiredPreparations = vi.fn(() => {
      throw new Error("preparation cleanup unavailable");
    });
    const purgeExpired = vi.fn(async () => 3);

    await expect(
      runSearchAlertRetention(
        { purgeExpired: purgeExpiredPreparations },
        { purgeExpired },
        { now: "2026-08-30T09:30:00.000Z", limit: 100 },
      ),
    ).resolves.toEqual({
      purgedPreparations: 0,
      purgedIdempotency: 3,
      failed: ["preparation"],
    });
    expect(purgeExpired).toHaveBeenCalledOnce();
  });

  it("rejects an unbounded maintenance batch", async () => {
    const purgeExpiredPreparations = vi.fn(async () => 0);
    const purgeExpired = vi.fn(async () => 0);

    await expect(
      runSearchAlertRetention(
        { purgeExpired: purgeExpiredPreparations },
        { purgeExpired },
        {
          now: "2026-08-30T09:30:00.000Z",
          limit: 1_001,
        },
      ),
    ).rejects.toThrow("between 1 and 1000");
    expect(purgeExpiredPreparations).not.toHaveBeenCalled();
    expect(purgeExpired).not.toHaveBeenCalled();
  });
});
