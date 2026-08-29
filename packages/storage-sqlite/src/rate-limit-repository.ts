import type {
  RateLimitCheckInput,
  RateLimitDecision,
  RateLimitRepository,
} from "@jobbbler/storage";

import type { SqliteDatabase } from "./connection.js";

interface RateLimitWindowRow {
  readonly count: number;
  readonly reset_at_ms: number;
}

function validateInput(input: RateLimitCheckInput): void {
  if (typeof input.key !== "string" || input.key.trim().length === 0 || input.key.length > 512) {
    throw new TypeError("Rate-limit key must be between 1 and 512 characters.");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
    throw new TypeError("Rate limit must be a positive integer.");
  }
  if (!Number.isSafeInteger(input.windowMs) || input.windowMs < 1) {
    throw new TypeError("Rate-limit window must be a positive integer.");
  }
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    throw new TypeError("Rate-limit time must be a non-negative integer.");
  }
  if (input.nowMs > Number.MAX_SAFE_INTEGER - input.windowMs) {
    throw new TypeError("Rate-limit window exceeds the supported timestamp range.");
  }
}

function decision(count: number, resetAtMs: number, input: RateLimitCheckInput): RateLimitDecision {
  if (count >= input.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - input.nowMs) / 1_000)),
      resetAtMs,
    };
  }
  const nextCount = count + 1;
  return {
    allowed: true,
    remaining: input.limit - nextCount,
    retryAfterSeconds: 0,
    resetAtMs,
  };
}

/**
 * SQLite-backed fixed-window limiter. The immediate transaction makes each
 * check-and-increment atomic across concurrent server processes sharing the DB.
 */
export function createSqliteRateLimitRepository(database: SqliteDatabase): RateLimitRepository {
  return {
    async check(input) {
      validateInput(input);
      const check = database.transaction(() => {
        const existing = database
          .prepare("SELECT count, reset_at_ms FROM rate_limit_windows WHERE key = ?")
          .get(input.key) as RateLimitWindowRow | undefined;
        const resetAtMs = input.nowMs + input.windowMs;

        if (existing === undefined || existing.reset_at_ms <= input.nowMs) {
          database
            .prepare(
              `INSERT INTO rate_limit_windows(key, count, reset_at_ms)
               VALUES (?, 1, ?)
               ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at_ms = excluded.reset_at_ms`,
            )
            .run(input.key, resetAtMs);
          return {
            allowed: true,
            remaining: input.limit - 1,
            retryAfterSeconds: 0,
            resetAtMs,
          };
        }

        const result = decision(existing.count, existing.reset_at_ms, input);
        if (result.allowed) {
          database
            .prepare("UPDATE rate_limit_windows SET count = count + 1 WHERE key = ?")
            .run(input.key);
        }
        return result;
      });
      return check.immediate();
    },
  };
}
