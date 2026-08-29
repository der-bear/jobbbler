import { toolActivitySchema } from "@jobbbler/contracts";

import type { AgentActivity, AgentActivityStatus } from "./types.js";

interface ActivityClock {
  now(): Date;
}

type ActivityListener = (activities: readonly AgentActivity[]) => void;

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nearestLocalActivityIndex(
  activities: readonly AgentActivity[],
  committed: AgentActivity,
): number {
  const committedStartedAt = Date.parse(committed.startedAt);
  if (!Number.isFinite(committedStartedAt)) return -1;
  let nearestIndex = -1;
  let nearestDistance = 10_001;
  activities.forEach((candidate, index) => {
    if (!candidate.id.startsWith("act_") || candidate.toolName !== committed.toolName) return;
    const candidateStartedAt = Date.parse(candidate.startedAt);
    if (!Number.isFinite(candidateStartedAt)) return;
    const distance = Math.abs(candidateStartedAt - committedStartedAt);
    if (distance > 10_000 || distance >= nearestDistance) return;
    nearestIndex = index;
    nearestDistance = distance;
  });
  return nearestIndex;
}

export class AgentActivityStore {
  readonly #clock: ActivityClock;
  readonly #maxItems: number;
  #activities: readonly AgentActivity[] = Object.freeze([]);
  readonly #listeners = new Set<ActivityListener>();

  constructor(options: Readonly<{ maxItems?: number; now?: () => Date }> = {}) {
    const maxItems = options.maxItems ?? 100;
    if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 500) {
      throw new Error("Agent Activity history must contain between 1 and 500 items.");
    }
    this.#clock = { now: options.now ?? (() => new Date()) };
    this.#maxItems = maxItems;
  }

  snapshot(): readonly AgentActivity[] {
    return this.#activities;
  }

  subscribe(listener: ActivityListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(
    toolName: string,
    safeSummary: string,
    options: Readonly<{ correlationId?: string; affectedResourceIds?: readonly string[] }> = {},
  ): string {
    const id = randomId("act");
    this.#publish([
      ...this.#activities,
      {
        id,
        toolName,
        status: "running",
        safeSummary,
        correlationId: options.correlationId ?? randomId("req"),
        startedAt: this.#clock.now().toISOString(),
        completedAt: null,
        affectedResourceIds: [...(options.affectedResourceIds ?? [])],
      },
    ]);
    return id;
  }

  finish(id: string, status: Exclude<AgentActivityStatus, "running">, safeSummary: string): void {
    const index = this.#activities.findIndex((activity) => activity.id === id);
    if (index === -1) return;
    const current = this.#activities[index]!;
    if (current.status !== "running") return;
    this.#publish(
      this.#activities.map((activity, activityIndex) =>
        activityIndex === index
          ? {
              ...current,
              status,
              safeSummary,
              completedAt: this.#clock.now().toISOString(),
            }
          : activity,
      ),
    );
  }

  mergeCommitted(activities: readonly AgentActivity[]): void {
    const committed = activities.map((activity) => ({
      ...toolActivitySchema.parse(activity),
      affectedResourceIds: [],
    }));
    const next = [...this.#activities];
    let changed = false;
    for (const activity of committed) {
      const exactIndex = next.findIndex(
        (candidate) =>
          candidate.id === activity.id ||
          (candidate.correlationId === activity.correlationId &&
            candidate.toolName === activity.toolName),
      );
      const index = exactIndex === -1 ? nearestLocalActivityIndex(next, activity) : exactIndex;
      if (index === -1) {
        next.push(activity);
        changed = true;
        continue;
      }
      const current = next[index]!;
      if (JSON.stringify(current) === JSON.stringify(activity)) continue;
      next[index] = activity;
      changed = true;
    }
    if (!changed) return;
    next.sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id),
    );
    this.#publish(next);
  }

  #publish(activities: readonly AgentActivity[]): void {
    this.#activities = Object.freeze(activities.slice(-this.#maxItems));
    const snapshot = this.snapshot();
    this.#listeners.forEach((listener) => listener(snapshot));
  }
}
