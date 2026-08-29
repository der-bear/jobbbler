import { describe, expect, it } from "vitest";

import { createMemoryRateLimiter } from "./rate-limit";

describe("memory rate limiter", () => {
  it("allows a bounded window and returns precise safe retry guidance", async () => {
    const limiter = createMemoryRateLimiter({ maximumKeys: 100 });

    await expect(
      limiter.check({ key: "search:client-a", limit: 2, windowMs: 60_000, nowMs: 1_000 }),
    ).resolves.toEqual({ allowed: true, remaining: 1, retryAfterSeconds: 0, resetAtMs: 61_000 });
    await expect(
      limiter.check({ key: "search:client-a", limit: 2, windowMs: 60_000, nowMs: 2_000 }),
    ).resolves.toEqual({ allowed: true, remaining: 0, retryAfterSeconds: 0, resetAtMs: 61_000 });
    await expect(
      limiter.check({ key: "search:client-a", limit: 2, windowMs: 60_000, nowMs: 3_000 }),
    ).resolves.toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 58, resetAtMs: 61_000 });
  });

  it("isolates keys and resets after the fixed window", async () => {
    const limiter = createMemoryRateLimiter();
    const input = { limit: 1, windowMs: 10_000, nowMs: 5_000 };

    await expect(limiter.check({ ...input, key: "a" })).resolves.toMatchObject({ allowed: true });
    await expect(limiter.check({ ...input, key: "b" })).resolves.toMatchObject({ allowed: true });
    await expect(limiter.check({ ...input, key: "a", nowMs: 15_000 })).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
      resetAtMs: 25_000,
    });
  });

  it("rejects invalid limits before mutating state", async () => {
    const limiter = createMemoryRateLimiter();
    await expect(limiter.check({ key: "a", limit: 0, windowMs: 1_000, nowMs: 0 })).rejects.toThrow(
      "Rate limit must be a positive integer",
    );
  });
});
