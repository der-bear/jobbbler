import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OwnerActivityPage } from "@jobbbler/contracts";

import { ApiClientError } from "./query-client";
import { ownerActivityToToolActivity, startOwnerActivityFeed } from "./owner-activity-feed";

const event = {
  id: "activity_550e8400-e29b-41d4-a716-446655440000",
  schemaVersion: 1 as const,
  kind: "tool" as const,
  key: "edit_application",
  status: "completed" as const,
  safeSummary: "Application draft updated.",
  correlationId: "corr_550e8400-e29b-41d4-a716-446655440000",
  actorKind: "agent" as const,
  aggregate: { type: "application_draft" as const, version: 3 },
  occurredAt: "2026-08-29T10:00:00.000Z",
  effects: [{ target: "application" as const, kind: "refresh" as const }],
};

function page(overrides: Partial<OwnerActivityPage> = {}): OwnerActivityPage {
  return {
    events: [event],
    nextCursor: "v1.MQ.signature",
    hasMore: false,
    resyncRequired: false,
    pollAfterMs: 5_000,
    ...overrides,
  };
}

describe("owner activity feed", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("maps only the safe event projection into the existing Agent Activity model", () => {
    expect(ownerActivityToToolActivity(event)).toEqual({
      id: event.id,
      toolName: "edit_application",
      status: "completed",
      safeSummary: "Application draft updated.",
      correlationId: event.correlationId,
      startedAt: event.occurredAt,
      completedAt: event.occurredAt,
      affectedResourceIds: [],
    });
  });

  it("polls immediately, advances the authoritative cursor, and uses the server interval", async () => {
    const mergeCommitted = vi.fn();
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page({ events: [], nextCursor: "v1.Mg.signature" }));
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted },
      fetchPage,
      isVisible: () => true,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPage).toHaveBeenNthCalledWith(1, null, expect.any(AbortSignal));
    expect(mergeCommitted).toHaveBeenCalledWith([ownerActivityToToolActivity(event)]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "v1.MQ.signature", expect.any(AbortSignal));
    feed.stop();
  });

  it("bounds catch-up bursts and honors durable retry-after backoff", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page({ hasMore: true, pollAfterMs: 1_000 }))
      .mockRejectedValueOnce(
        new ApiClientError({
          code: "RATE_LIMITED",
          message: "Slow down.",
          retryable: true,
          retryAfterSeconds: 17,
        }),
      )
      .mockResolvedValue(page({ events: [] }));
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersToNextTimerAsync();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(16_999);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    feed.stop();
  });

  it("coalesces wakeups while a request is active and aborts cleanly", async () => {
    let resolvePage: ((value: OwnerActivityPage) => void) | undefined;
    let wakeup: (() => void) | undefined;
    let activeSignal: AbortSignal | undefined;
    const fetchPage = vi.fn(async (_cursor: string | null, signal: AbortSignal) => {
      activeSignal = signal;
      return await new Promise<OwnerActivityPage>((resolve) => {
        resolvePage = resolve;
      });
    });
    const removeWakeup = vi.fn();
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
      subscribeWakeups: (wake) => {
        wakeup = wake;
        return Promise.resolve(removeWakeup);
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    wakeup?.();
    wakeup?.();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    resolvePage?.(page());
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    feed.stop();
    expect(removeWakeup).toHaveBeenCalledOnce();
    expect(activeSignal?.aborted).toBe(true);
  });
});
