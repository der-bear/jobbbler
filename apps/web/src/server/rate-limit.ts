export interface RateLimitCheckInput {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly nowMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly resetAtMs: number;
}

export interface RateLimiter {
  check(input: RateLimitCheckInput): Promise<RateLimitDecision>;
}

interface WindowState {
  count: number;
  resetAtMs: number;
}

export interface MemoryRateLimiterOptions {
  readonly maximumKeys?: number;
}

export function createMemoryRateLimiter(options: MemoryRateLimiterOptions = {}): RateLimiter {
  const maximumKeys = options.maximumKeys ?? 10_000;
  if (!Number.isSafeInteger(maximumKeys) || maximumKeys < 1) {
    throw new Error("Maximum rate-limit keys must be a positive integer.");
  }
  const windows = new Map<string, WindowState>();

  return {
    async check(input) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
        throw new Error("Rate limit must be a positive integer.");
      }
      if (!Number.isSafeInteger(input.windowMs) || input.windowMs < 1) {
        throw new Error("Rate-limit window must be a positive integer.");
      }
      if (!Number.isFinite(input.nowMs) || input.nowMs < 0) {
        throw new Error("Rate-limit time must be a non-negative number.");
      }
      if (input.key.trim().length === 0 || input.key.length > 512) {
        throw new Error("Rate-limit key must be between 1 and 512 characters.");
      }

      let state = windows.get(input.key);
      if (state === undefined || state.resetAtMs <= input.nowMs) {
        if (state === undefined && windows.size >= maximumKeys) {
          for (const [key, candidate] of windows) {
            if (candidate.resetAtMs <= input.nowMs) windows.delete(key);
          }
          if (windows.size >= maximumKeys) {
            const oldestKey = windows.keys().next().value as string | undefined;
            if (oldestKey !== undefined) windows.delete(oldestKey);
          }
        }
        state = { count: 0, resetAtMs: input.nowMs + input.windowMs };
        windows.set(input.key, state);
      }

      if (state.count >= input.limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((state.resetAtMs - input.nowMs) / 1_000)),
          resetAtMs: state.resetAtMs,
        };
      }

      state.count += 1;
      return {
        allowed: true,
        remaining: input.limit - state.count,
        retryAfterSeconds: 0,
        resetAtMs: state.resetAtMs,
      };
    },
  };
}
