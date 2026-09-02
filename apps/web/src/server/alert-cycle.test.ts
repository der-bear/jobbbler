import { describe, expect, it, vi } from "vitest";

import { createAlertCyclePostHandler } from "./alert-cycle";

const secret = "s".repeat(43);

function request(authorization?: string): Request {
  return new Request("https://jobbbler.test/api/internal/alert-cycle", {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("internal alert-cycle route", () => {
  it("fails closed when the production secret is unavailable", async () => {
    const run = vi.fn();
    const handler = createAlertCyclePostHandler({ environment: {}, run });

    const response = await handler(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects requests that do not carry the exact bearer secret", async () => {
    const run = vi.fn();
    const handler = createAlertCyclePostHandler({ environment: { CRON_SECRET: secret }, run });

    const response = await handler(request("Bearer wrong"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.json()).toEqual({ status: "unauthorized" });
    expect(run).not.toHaveBeenCalled();
  });

  it("runs one bounded alert cycle for an authorized scheduler", async () => {
    const summary = {
      evaluated: 2,
      queued: 1,
      delivered: 1,
      failed: 0,
      purged: 0,
      heartbeatAt: "2026-09-02T18:00:00.000Z",
    } as const;
    const run = vi.fn(async () => summary);
    const handler = createAlertCyclePostHandler({ environment: { CRON_SECRET: secret }, run });
    const incoming = request(`Bearer ${secret}`);

    const response = await handler(incoming);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "completed", ...summary });
    expect(run).toHaveBeenCalledWith({ signal: incoming.signal });
  });

  it("returns a generic retriable failure without leaking dependency details", async () => {
    const run = vi.fn(async () => {
      throw new Error("secret database host");
    });
    const handler = createAlertCyclePostHandler({ environment: { CRON_SECRET: secret }, run });

    const response = await handler(request(`Bearer ${secret}`));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "failed" });
  });
});
