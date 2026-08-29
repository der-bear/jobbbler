import type { AgentActivity, AgentActivityStatus } from "./types.js";

interface ActivityClock {
  now(): Date;
}

type ActivityListener = (activities: readonly AgentActivity[]) => void;

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
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

  #publish(activities: readonly AgentActivity[]): void {
    this.#activities = Object.freeze(activities.slice(-this.#maxItems));
    const snapshot = this.snapshot();
    this.#listeners.forEach((listener) => listener(snapshot));
  }
}
