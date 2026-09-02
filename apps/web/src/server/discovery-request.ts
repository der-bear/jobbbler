import { DomainError } from "@jobbbler/core-domain";

import { apiErrorResponse } from "./api-response";
import type { DiscoveryRouteDependencies } from "./commands";
import { getRateLimitKey } from "./context";
import type { RateLimitDecision } from "./rate-limit";

export const publicJobSearchPolicy = {
  scope: "jobs.search",
  // Search is read-only and inexpensive. Keep enough headroom for agent retries
  // and several challenge judges sharing one office or conference NAT.
  limit: 240,
  cacheControl: "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  revalidateSeconds: 60,
} as const;

export async function checkDiscoveryRateLimit(
  request: Request,
  requestId: string,
  scope: string,
  dependencies: DiscoveryRouteDependencies,
  limit: number,
): Promise<{ readonly response: Response | null; readonly decision: RateLimitDecision }> {
  const decision = await dependencies.rateLimiter.check({
    key: getRateLimitKey(request, scope),
    limit,
    windowMs: 60_000,
    nowMs: dependencies.nowMs(),
  });
  if (decision.allowed) return { response: null, decision };

  return {
    decision,
    response: apiErrorResponse(
      new DomainError({
        code: "RATE_LIMITED",
        message: "Too many requests. Try again shortly.",
        retryable: true,
      }),
      { requestId, retryAfterSeconds: decision.retryAfterSeconds },
    ),
  };
}

export function rateLimitHeaders(decision: RateLimitDecision): HeadersInit {
  return {
    "ratelimit-remaining": String(decision.remaining),
    "ratelimit-reset": String(Math.ceil(decision.resetAtMs / 1_000)),
  };
}
