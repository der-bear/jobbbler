import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { takeToolRequestCorrelation } from "@jobbbler/webmcp";

import { ApiClientError, queryApi } from "./query-client";

const requestId = "req_550e8400-e29b-41d4-a716-446655440000";

describe("typed API query client", () => {
  it("validates successful data and forwards cancellation", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        data: { total: 3 },
        meta: { requestId },
      }),
    );

    await expect(
      queryApi("/api/v1/jobs/search?q=platform", z.object({ total: z.number() }), {
        fetch,
        signal: controller.signal,
      }),
    ).resolves.toEqual({ total: 3 });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/jobs/search?q=platform",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        signal: controller.signal,
      }),
    );
    expect(takeToolRequestCorrelation(controller.signal)).toBe(requestId);
  });

  it("throws a typed safe error for an API error envelope", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Try again shortly.",
            requestId,
            retryable: true,
          },
        },
        { status: 429, headers: { "retry-after": "12" } },
      ),
    );

    const error = await queryApi("/api/v1/jobs/search", z.object({ total: z.number() }), {
      fetch,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "RATE_LIMITED",
      requestId,
      retryable: true,
      retryAfterSeconds: 12,
    });
  });

  it("treats malformed server output as an untrusted dependency failure", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, data: { total: "many" } }));

    await expect(
      queryApi("/api/v1/jobs/search", z.object({ total: z.number() }), { fetch }),
    ).rejects.toMatchObject({ code: "DEPENDENCY", retryable: true });
  });

  it("supports typed same-origin mutation methods", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ ok: true, data: { enabled: false }, meta: { requestId } }),
    );
    await queryApi("/api/v1/schedules/schedule_1", z.object({ enabled: z.boolean() }), {
      fetch,
      method: "PATCH",
      body: { expectedVersion: 0, enabled: false },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/schedules/schedule_1",
      expect.objectContaining({ method: "PATCH", body: '{"expectedVersion":0,"enabled":false}' }),
    );
  });
});
