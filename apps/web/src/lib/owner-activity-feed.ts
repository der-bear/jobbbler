import {
  ownerActivityPageSchema,
  type OwnerActivityEvent,
  type OwnerActivityPage,
  type ToolActivity,
} from "@jobbbler/contracts";
import type { AgentActivityStore } from "@jobbbler/webmcp";

import { ApiClientError, queryApi } from "./query-client";

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const HIDDEN_DELAY_MS = 30_000;
const DEFAULT_MAX_CATCH_UP_PAGES = 5;
const IDLE_JITTER_RATIO = 0.1;

export interface OwnerActivityFeedOptions {
  readonly activities: Pick<AgentActivityStore, "mergeCommitted">;
  readonly fetchPage?: (cursor: string | null, signal: AbortSignal) => Promise<OwnerActivityPage>;
  readonly subscribeWakeups?: (wakeup: () => void) => Promise<(() => void) | null>;
  readonly isVisible?: () => boolean;
  readonly subscribeVisibility?: (listener: () => void) => () => void;
  readonly maxCatchUpPages?: number;
  readonly random?: () => number;
}

export interface OwnerActivityFeedController {
  wake(): void;
  stop(): void;
}

export function ownerActivityToToolActivity(event: OwnerActivityEvent): ToolActivity {
  return {
    id: event.id,
    toolName: event.key,
    status: event.status,
    safeSummary: event.safeSummary,
    correlationId: event.correlationId,
    startedAt: event.occurredAt,
    completedAt: event.status === "running" ? null : event.occurredAt,
    affectedResourceIds: [],
  };
}

export function fetchOwnerActivityPage(
  cursor: string | null,
  signal: AbortSignal,
): Promise<OwnerActivityPage> {
  const parameters = new URLSearchParams({ limit: "50" });
  if (cursor !== null) parameters.set("cursor", cursor);
  return queryApi(`/api/v1/owners/activity?${parameters.toString()}`, ownerActivityPageSchema, {
    signal,
  });
}

function boundedDelay(value: number): number {
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(value)));
}

function failureDelay(error: unknown, failures: number): number {
  if (error instanceof ApiClientError) {
    if (error.retryAfterSeconds !== null) return boundedDelay(error.retryAfterSeconds * 1_000);
    if (error.code === "UNAUTHORIZED") return MAX_DELAY_MS;
  }
  return boundedDelay(1_000 * 2 ** Math.min(5, Math.max(0, failures - 1)));
}

function idleDelay(serverDelayMs: number, idlePolls: number, random: () => number): number {
  const multiplier = Math.min(6, 2 ** Math.min(3, idlePolls));
  const baseDelay = boundedDelay(serverDelayMs * multiplier);
  const sample = random();
  const normalizedSample = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5;
  const minimumDelay = Math.max(MIN_DELAY_MS, baseDelay * (1 - IDLE_JITTER_RATIO));
  const maximumDelay = Math.min(MAX_DELAY_MS, baseDelay * (1 + IDLE_JITTER_RATIO));
  return boundedDelay(minimumDelay + normalizedSample * (maximumDelay - minimumDelay));
}

function browserVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function browserVisibilitySubscription(listener: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

export function startOwnerActivityFeed(
  options: OwnerActivityFeedOptions,
): OwnerActivityFeedController {
  const fetchPage = options.fetchPage ?? fetchOwnerActivityPage;
  const isVisible = options.isVisible ?? browserVisible;
  const random = options.random ?? Math.random;
  const maxCatchUpPages = options.maxCatchUpPages ?? DEFAULT_MAX_CATCH_UP_PAGES;
  if (!Number.isSafeInteger(maxCatchUpPages) || maxCatchUpPages < 1 || maxCatchUpPages > 10) {
    throw new Error("Activity catch-up pages must be an integer between 1 and 10.");
  }

  let stopped = false;
  let inFlight = false;
  let wakePending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestController: AbortController | undefined;
  let removeWakeup: (() => void) | undefined;
  let wakeTransportActive = false;
  let cursor: string | null = null;
  let failures = 0;
  let catchUpPages = 0;
  let idlePolls = 0;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (delayMs: number) => {
    if (stopped) return;
    clearTimer();
    timer = setTimeout(
      () => {
        timer = undefined;
        void poll();
      },
      Math.max(0, delayMs),
    );
  };

  const poll = async () => {
    if (stopped) return;
    if (inFlight) {
      wakePending = true;
      return;
    }
    if (!isVisible()) {
      schedule(HIDDEN_DELAY_MS);
      return;
    }
    inFlight = true;
    requestController = new AbortController();
    let delay = MAX_DELAY_MS;
    try {
      const page = await fetchPage(cursor, requestController.signal);
      if (stopped) return;
      options.activities.mergeCommitted(page.events.map(ownerActivityToToolActivity));
      cursor = page.nextCursor;
      failures = 0;
      if (page.hasMore && catchUpPages < maxCatchUpPages) {
        catchUpPages += 1;
        idlePolls = 0;
        delay = 0;
      } else {
        catchUpPages = 0;
        if (page.events.length > 0) {
          idlePolls = 0;
          delay = boundedDelay(page.pollAfterMs);
        } else if (wakeTransportActive) {
          idlePolls += 1;
          delay = idleDelay(page.pollAfterMs, idlePolls, random);
        } else {
          idlePolls = 0;
          delay = boundedDelay(page.pollAfterMs);
        }
      }
    } catch (error) {
      if (stopped || requestController.signal.aborted) return;
      failures += 1;
      catchUpPages = 0;
      delay = failureDelay(error, failures);
    } finally {
      inFlight = false;
      requestController = undefined;
      if (!stopped) {
        if (wakePending) {
          wakePending = false;
          idlePolls = 0;
          schedule(0);
        } else {
          schedule(delay);
        }
      }
    }
  };

  const wake = () => {
    if (stopped) return;
    idlePolls = 0;
    if (inFlight) {
      wakePending = true;
      return;
    }
    schedule(0);
  };

  const removeVisibility = (options.subscribeVisibility ?? browserVisibilitySubscription)(() => {
    if (isVisible()) wake();
  });
  if (options.subscribeWakeups !== undefined) {
    void options
      .subscribeWakeups(wake)
      .then((remove) => {
        if (remove === null) return;
        if (stopped) {
          remove();
        } else {
          wakeTransportActive = true;
          removeWakeup = remove;
          wake();
        }
      })
      .catch(() => undefined);
  }
  schedule(0);

  return {
    wake,
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimer();
      requestController?.abort();
      removeWakeup?.();
      removeVisibility();
    },
  };
}
