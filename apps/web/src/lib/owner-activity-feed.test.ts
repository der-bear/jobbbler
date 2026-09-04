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
      toolName: "propose_application_updates",
      status: "completed",
      safeSummary: "Application updates prepared for review.",
      correlationId: event.correlationId,
      startedAt: event.occurredAt,
      completedAt: event.occurredAt,
      affectedResourceIds: [],
    });
  });

  it("projects private application commands onto the public WebMCP tool names", () => {
    expect(
      ownerActivityToToolActivity({
        ...event,
        key: "request_agent_access",
        status: "requires_user_action",
        safeSummary: "Agent requested scoped application access.",
      }),
    ).toMatchObject({
      toolName: "request_application_assistance",
      status: "requires_user_action",
      safeSummary: "Preparation permission requested for this application.",
    });

    expect(
      ownerActivityToToolActivity({
        ...event,
        key: "approve_agent_access",
        status: "completed",
        safeSummary: "Scoped application assistance approved through the agent client.",
      }),
    ).toMatchObject({
      toolName: "request_application_assistance",
      status: "completed",
      safeSummary: "Preparation allowed. Nothing is sent until you approve the exact application.",
    });

    expect(
      ownerActivityToToolActivity({
        ...event,
        key: "edit_application",
        safeSummary: "Application draft updated.",
      }),
    ).toMatchObject({
      toolName: "propose_application_updates",
      safeSummary: "Application updates prepared for review.",
    });

    expect(
      ownerActivityToToolActivity({
        ...event,
        key: "delete_saved_search",
        safeSummary: "Saved search and its job alert were removed.",
      }),
    ).toMatchObject({
      toolName: "set_job_alert_state",
      safeSummary: "Saved search and its job alert were removed.",
    });
  });

  it.each([
    "validate_application",
    "review_application",
    "request_data_consent",
    "approve_data_grant",
    "request_final_confirmation",
  ])("keeps internal orchestration event %s out of the public activity panel", (key) => {
    expect(
      ownerActivityToToolActivity({
        ...event,
        key,
        safeSummary: "Internal application orchestration completed.",
      }),
    ).toBeNull();
  });

  it("keeps human and service events out of the agent activity feed", async () => {
    const mergeCommitted = vi.fn();
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted },
      fetchPage: vi.fn().mockResolvedValue(
        page({
          events: [
            { ...event, actorKind: "human" },
            {
              ...event,
              id: "activity_650e8400-e29b-41d4-a716-446655440000",
              correlationId: "corr_650e8400-e29b-41d4-a716-446655440000",
              actorKind: "service",
            },
            {
              ...event,
              id: "activity_750e8400-e29b-41d4-a716-446655440000",
              correlationId: "corr_750e8400-e29b-41d4-a716-446655440000",
              actorKind: "agent",
            },
          ],
        }),
      ),
      isVisible: () => true,
      hasOwnerSession: () => true,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(mergeCommitted).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "activity_750e8400-e29b-41d4-a716-446655440000",
      }),
    ]);
    feed.stop();
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
      hasOwnerSession: () => true,
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

  it("backs off idle visible polling after the wake transport is confirmed", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page({ events: [] }));
    const randomSamples = [0.5, 0.5, 1];
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => randomSamples.shift() ?? 1,
      subscribeWakeups: async () => () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPage).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchPage).toHaveBeenCalledTimes(5);
    feed.stop();
  });

  it("keeps the server polling cadence when the wake transport is omitted", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page({ events: [] }));
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => 0.5,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    feed.stop();
  });

  it("keeps the server polling cadence while wake transport confirmation is pending", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page({ events: [] }));
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => 0.5,
      subscribeWakeups: () => new Promise(() => undefined),
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    feed.stop();
  });

  it("polls immediately when a pending wake transport becomes confirmed", async () => {
    let confirmSubscription: ((remove: () => void) => void) | undefined;
    const fetchPage = vi.fn().mockResolvedValue(page({ events: [] }));
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => 0.5,
      subscribeWakeups: () =>
        new Promise((resolve) => {
          confirmSubscription = resolve;
        }),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    confirmSubscription?.(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    feed.stop();
  });

  it("keeps the server polling cadence after wake transport confirmation is rejected", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page({ events: [] }));
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => 0.5,
      subscribeWakeups: async () => {
        throw new Error("Realtime unavailable.");
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    feed.stop();
  });

  it("keeps the server polling cadence when wake transport setup resolves inactive", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page({ events: [] }));
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => 0.5,
      subscribeWakeups: async () => null,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    feed.stop();
  });

  it("resets idle backoff after committed activity and an explicit wakeup", async () => {
    let wakeup: (() => void) | undefined;
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page({ events: [] }))
      .mockResolvedValueOnce(page({ events: [] }))
      .mockResolvedValueOnce(page())
      .mockResolvedValue(page({ events: [] }));
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => 0.5,
      subscribeWakeups: (wake) => {
        wakeup = wake;
        return Promise.resolve(() => undefined);
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    wakeup?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPage).toHaveBeenCalledTimes(4);
    feed.stop();
  });

  it("jitters idle retries so browser sessions do not poll in lockstep", async () => {
    const lowerFetch = vi.fn().mockResolvedValue(page({ events: [] }));
    const upperFetch = vi.fn().mockResolvedValue(page({ events: [] }));
    const lower = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage: lowerFetch,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => 0,
      subscribeWakeups: async () => () => undefined,
    });
    const upper = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage: upperFetch,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => 1,
      subscribeWakeups: async () => () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(lowerFetch).toHaveBeenCalledTimes(2);
    expect(upperFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(upperFetch).toHaveBeenCalledTimes(2);
    lower.stop();
    upper.stop();
  });

  it("retains downward jitter when the idle delay reaches the thirty-second cap", async () => {
    const lowerFetch = vi.fn().mockResolvedValue(page({ events: [], pollAfterMs: 30_000 }));
    const upperFetch = vi.fn().mockResolvedValue(page({ events: [], pollAfterMs: 30_000 }));
    const lower = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage: lowerFetch,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => 0,
      subscribeWakeups: async () => () => undefined,
    });
    const upper = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage: upperFetch,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => 1,
      subscribeWakeups: async () => () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(26_999);
    expect(lowerFetch).toHaveBeenCalledTimes(1);
    expect(upperFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(lowerFetch).toHaveBeenCalledTimes(2);
    expect(upperFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(upperFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(upperFetch).toHaveBeenCalledTimes(2);
    lower.stop();
    upper.stop();
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
      hasOwnerSession: () => true,
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
      hasOwnerSession: () => true,
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

  it("resets idle backoff when a wake is consumed after an in-flight empty read", async () => {
    let resolveFirstPage: ((value: OwnerActivityPage) => void) | undefined;
    let wakeup: (() => void) | undefined;
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          await new Promise<OwnerActivityPage>((resolve) => {
            resolveFirstPage = resolve;
          }),
      )
      .mockResolvedValue(page({ events: [] }));
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
      hasOwnerSession: () => true,
      random: () => 0.5,
      subscribeWakeups: async (wake) => {
        wakeup = wake;
        return () => undefined;
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    wakeup?.();
    resolveFirstPage?.(page({ events: [] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    feed.stop();
  });
});

describe("owner activity feed session gating", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays silent until this browser has a private workspace", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page({ events: [], nextCursor: null }));
    let started: (() => void) | undefined;
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
      hasOwnerSession: () => false,
      subscribeOwnerSession: (listener) => {
        started = listener;
        return () => undefined;
      },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchPage).not.toHaveBeenCalled();

    started?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    feed.stop();
  });

  it("suspends after an unauthorized activity response until a new session starts", async () => {
    const fetchPage = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ code: "UNAUTHORIZED", message: "Session expired.", retryable: false }),
      );
    let started: (() => void) | undefined;
    const feed = startOwnerActivityFeed({
      activities: { mergeCommitted: vi.fn() },
      fetchPage,
      isVisible: () => true,
      hasOwnerSession: () => true,
      subscribeOwnerSession: (listener) => {
        started = listener;
        return () => undefined;
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchPage).toHaveBeenCalledTimes(1);

    started?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    feed.stop();
  });
});
