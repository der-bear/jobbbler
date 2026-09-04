import {
  ownerActivityPageSchema,
  type OwnerActivityEvent,
  type OwnerActivityPage,
  type ToolActivity,
} from "@jobbbler/contracts";
import type { AgentActivityStore } from "@jobbbler/webmcp";

import {
  clearOwnerSessionMarker,
  hasOwnerSessionMarker,
  subscribeOwnerSessionStarted,
} from "./owner-session-marker";
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
  readonly hasOwnerSession?: () => boolean;
  readonly subscribeOwnerSession?: (listener: () => void) => () => void;
}

export interface OwnerActivityFeedController {
  wake(): void;
  stop(): void;
}

interface PublicActivityCopy {
  readonly safeSummary?: string;
  readonly toolName: string;
}

const publicActivityCopyByServerKey: Readonly<Record<string, PublicActivityCopy>> = {
  approve_agent_access: {
    toolName: "request_application_assistance",
    safeSummary: "Preparation allowed. Nothing is sent until you approve the exact application.",
  },
  delete_saved_search: { toolName: "set_job_alert_state" },
  edit_application: {
    toolName: "propose_application_updates",
    safeSummary: "Application updates prepared for review.",
  },
  request_agent_access: {
    toolName: "request_application_assistance",
    safeSummary: "Preparation permission requested for this application.",
  },
  revoke_agent_access: { toolName: "decide_application_assistance" },
  submit_application: {
    toolName: "decide_application_submission",
    safeSummary: "Application submitted and receipt saved.",
  },
};

const internalApplicationActivityKeys = new Set([
  "approve_data_grant",
  "request_data_consent",
  "request_final_confirmation",
  "review_application",
  "validate_application",
]);

export function ownerActivityToToolActivity(event: OwnerActivityEvent): ToolActivity | null {
  if (internalApplicationActivityKeys.has(event.key)) return null;
  const publicCopy = publicActivityCopyByServerKey[event.key];
  return {
    id: event.id,
    toolName: publicCopy?.toolName ?? event.key,
    status: event.status,
    safeSummary: publicCopy?.safeSummary ?? event.safeSummary,
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
  let waitingForOwnerSession = false;
  let removeOwnerSessionListener: (() => void) | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (delayMs: number) => {
    if (stopped || waitingForOwnerSession) return;
    clearTimer();
    timer = setTimeout(
      () => {
        timer = undefined;
        void poll();
      },
      Math.max(0, delayMs),
    );
  };

  const waitForOwnerSession = () => {
    waitingForOwnerSession = true;
    clearTimer();
    if (removeOwnerSessionListener !== undefined) return;
    const remove = subscribeOwnerSession(() => {
      if (stopped) return;
      removeOwnerSessionListener?.();
      removeOwnerSessionListener = undefined;
      waitingForOwnerSession = false;
      schedule(0);
    });
    removeOwnerSessionListener = remove;
  };

  const poll = async () => {
    if (stopped || waitingForOwnerSession) return;
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
      options.activities.mergeCommitted(
        page.events
          .filter((event) => event.actorKind === "agent")
          .flatMap((event) => {
            const activity = ownerActivityToToolActivity(event);
            return activity === null ? [] : [activity];
          }),
      );
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
      if (error instanceof ApiClientError && error.code === "UNAUTHORIZED") {
        clearOwnerSessionMarker();
        waitForOwnerSession();
        return;
      }
      failures += 1;
      catchUpPages = 0;
      delay = failureDelay(error, failures);
    } finally {
      inFlight = false;
      requestController = undefined;
      if (!stopped && !waitingForOwnerSession) {
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
    if (stopped || waitingForOwnerSession) return;
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
  /*
   * A visitor without a private workspace has no owner-scoped activity to
   * fetch, so polling waits until this browser has started one. That keeps the
   * public pages free of expected authorization failures.
   */
  const hasOwnerSession = options.hasOwnerSession ?? hasOwnerSessionMarker;
  const subscribeOwnerSession = options.subscribeOwnerSession ?? subscribeOwnerSessionStarted;
  if (hasOwnerSession()) {
    schedule(0);
  } else {
    removeOwnerSessionListener = subscribeOwnerSession(() => {
      if (stopped) return;
      removeOwnerSessionListener?.();
      removeOwnerSessionListener = undefined;
      schedule(0);
    });
  }

  return {
    wake,
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimer();
      requestController?.abort();
      removeWakeup?.();
      removeVisibility();
      removeOwnerSessionListener?.();
    },
  };
}
