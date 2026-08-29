import { z } from "zod";

import {
  entityIdSchema,
  type JobAlertSchedule,
  type SavedSearch,
  type SetJobAlertEnabledInput,
} from "@jobbbler/contracts";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import type { LatestSearchRun } from "@/lib/latest-run";

import {
  completedWebMcpResult,
  safeWebMcpErrorResult,
  type CompletedWebMcpResult,
  type SafeWebMcpErrorResult,
} from "@/lib/webmcp-tool-result";

const emptyInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const satisfies JsonSchema;

const stateInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scheduleId: {
      type: "string",
      description: "A schedule ID returned by get_saved_alerts.",
      pattern: "^schedule_[0-9a-f-]{36}$",
    },
    enabled: {
      type: "boolean",
      description: "True to resume monitoring; false to pause it.",
    },
  },
  required: ["scheduleId", "enabled"],
} as const satisfies JsonSchema;

const emptyInput = z.strictObject({});
const stateInput = z.strictObject({ scheduleId: entityIdSchema, enabled: z.boolean() });

const openSavedInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    savedSearchId: {
      type: "string",
      description: "A saved search ID returned by get_saved_alerts.",
      pattern: "^saved_search_[0-9a-f-]{36}$",
    },
  },
  required: ["savedSearchId"],
} as const satisfies JsonSchema;

const openSavedInput = z.strictObject({ savedSearchId: entityIdSchema });

const latestUpdateInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    savedSearchId: {
      type: "string",
      description: "A saved search ID returned by get_saved_alerts.",
      pattern: "^saved_search_[0-9a-f-]{36}$",
    },
  },
  required: ["savedSearchId"],
} as const satisfies JsonSchema;

export interface SavedToolDependencies {
  listSavedSearches(options: Readonly<{ signal: AbortSignal }>): Promise<readonly SavedSearch[]>;
  listSchedules(options: Readonly<{ signal: AbortSignal }>): Promise<readonly JobAlertSchedule[]>;
  setScheduleEnabled(
    scheduleId: string,
    input: SetJobAlertEnabledInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<JobAlertSchedule>;
  onScheduleCommitted(schedule: JobAlertSchedule): Promise<void> | void;
  savedSearchHref(savedSearch: SavedSearch): string;
  onNavigate(href: string): Promise<void> | void;
  getLatestRun(
    savedSearchId: string,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<LatestSearchRun>;
}

type SavedToolOutput = CompletedWebMcpResult<JsonValue> | SafeWebMcpErrorResult;

function short(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

export function createSavedToolManifests(
  dependencies: SavedToolDependencies,
): readonly ToolManifest<unknown, SavedToolOutput>[] {
  const getSavedAlerts: ToolManifest<unknown, SavedToolOutput> = {
    name: "get_saved_alerts",
    purpose: "Read the current owner's saved searches and alert states without delivery details.",
    description:
      "Read up to six saved job alerts visible in this private workspace, including schedule state and next check. Email destinations and credentials are never returned.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        const [savedSearches, schedules] = await Promise.all([
          dependencies.listSavedSearches({ signal }),
          dependencies.listSchedules({ signal }),
        ]);
        const scheduleBySearch = new Map(
          schedules.map((schedule) => [schedule.savedSearchId, schedule]),
        );
        const alerts = savedSearches.slice(0, 6).map((savedSearch) => {
          const schedule = scheduleBySearch.get(savedSearch.id);
          return {
            savedSearchId: savedSearch.id,
            name: short(savedSearch.name, 64),
            scheduleId: schedule?.id ?? null,
            enabled: schedule?.enabled ?? false,
            nextRunAt: schedule?.nextRunAt ?? null,
            frequency: schedule?.recurrence.frequency ?? null,
          };
        });
        return completedWebMcpResult({
          summary: `Read ${String(savedSearches.length)} saved job search${savedSearches.length === 1 ? "" : "es"}; ${String(schedules.filter(({ enabled }) => enabled).length)} alert${schedules.filter(({ enabled }) => enabled).length === 1 ? " is" : "s are"} active.`,
          data: { alerts, truncated: savedSearches.length > alerts.length },
          facts: [
            { key: "saved_searches", value: savedSearches.length },
            { key: "active_alerts", value: schedules.filter(({ enabled }) => enabled).length },
          ],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Saved alert state accepts no arguments.");
      }
    },
  };

  const setJobAlertState: ToolManifest<unknown, SavedToolOutput> = {
    name: "set_job_alert_state",
    purpose: "Pause or resume one existing saved job alert in the current private workspace.",
    description:
      "Pause or resume an alert returned by get_saved_alerts. This reversible action updates the visible workspace and never changes its criteria or email destination.",
    inputSchema: stateInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = stateInput.parse(input);
        const schedules = await dependencies.listSchedules({ signal });
        const current = schedules.find(({ id }) => id === parsed.scheduleId);
        if (current === undefined) {
          throw new z.ZodError([
            {
              code: "custom",
              path: ["scheduleId"],
              message: "The schedule is not in the current private workspace.",
            },
          ]);
        }
        const updated =
          current.enabled === parsed.enabled
            ? current
            : await dependencies.setScheduleEnabled(
                current.id,
                { expectedVersion: current.version, enabled: parsed.enabled },
                { signal },
              );
        await dependencies.onScheduleCommitted(updated);
        return completedWebMcpResult({
          summary: updated.enabled
            ? "Resumed this job alert and updated the visible workspace."
            : "Paused this job alert and updated the visible workspace.",
          data: {
            scheduleId: updated.id,
            savedSearchId: updated.savedSearchId,
            enabled: updated.enabled,
            nextRunAt: updated.nextRunAt,
            version: updated.version,
          },
          resources: [{ type: "job_alert", id: updated.id, label: "Saved job alert" }],
          facts: [{ key: "enabled", value: updated.enabled }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide an alert schedule ID from get_saved_alerts and the desired enabled state.",
        );
      }
    },
  };

  const openSavedSearch: ToolManifest<unknown, SavedToolOutput> = {
    name: "open_saved_search",
    purpose: "Open one saved search on the results page with its exact stored criteria.",
    description:
      "Navigate to the search page with the exact criteria of a saved search returned by get_saved_alerts. The search tools then apply to that restored search.",
    inputSchema: openSavedInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = openSavedInput.parse(input);
        const savedSearches = await dependencies.listSavedSearches({ signal });
        const savedSearch = savedSearches.find(({ id }) => id === parsed.savedSearchId);
        if (savedSearch === undefined) {
          throw new z.ZodError([
            {
              code: "custom",
              path: ["savedSearchId"],
              message: "The saved search is not in the current private workspace.",
            },
          ]);
        }
        await dependencies.onNavigate(dependencies.savedSearchHref(savedSearch));
        return completedWebMcpResult({
          summary: "Opened the saved search on the results page with its stored criteria.",
          data: { savedSearchId: savedSearch.id, route: "/" },
          resources: [
            { type: "saved_search", id: savedSearch.id, label: short(savedSearch.name, 64) },
          ],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide one saved search ID from get_saved_alerts.",
        );
      }
    },
  };

  const getLatestSearchUpdate: ToolManifest<unknown, SavedToolOutput> = {
    name: "get_latest_search_update",
    purpose: "Read what changed since a saved search was last checked, not the full result list.",
    description:
      "Read the most recent server-side check of one saved search: counts of new, updated, closed, and no-longer-matching roles, plus up to five change references. Monitoring runs without an open tab.",
    inputSchema: latestUpdateInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = openSavedInput.parse(input);
        const savedSearches = await dependencies.listSavedSearches({ signal });
        const savedSearch = savedSearches.find(({ id }) => id === parsed.savedSearchId);
        if (savedSearch === undefined) {
          throw new z.ZodError([
            {
              code: "custom",
              path: ["savedSearchId"],
              message: "The saved search is not in the current private workspace.",
            },
          ]);
        }
        const run = await dependencies.getLatestRun(savedSearch.id, { signal });
        if (run.evaluation === null) {
          return completedWebMcpResult({
            summary:
              "This saved search has not been checked yet. The next scheduled run will establish its baseline.",
            data: { savedSearchId: savedSearch.id, checked: false },
          });
        }
        const counts = { new: 0, updated: 0, closed: 0, no_longer_matching: 0 };
        for (const item of run.evaluation.changes.items) counts[item.kind] += 1;
        const parts = [
          counts.new > 0 ? `${String(counts.new)} new` : null,
          counts.updated > 0 ? `${String(counts.updated)} updated` : null,
          counts.closed > 0 ? `${String(counts.closed)} closed` : null,
          counts.no_longer_matching > 0
            ? `${String(counts.no_longer_matching)} no longer matching`
            : null,
        ].filter((part): part is string => part !== null);
        return completedWebMcpResult({
          summary:
            parts.length === 0
              ? "No meaningful changes since the last check."
              : `Since the last check: ${parts.join(", ")}.`,
          data: {
            savedSearchId: savedSearch.id,
            checked: true,
            checkedAt: run.evaluation.createdAt,
            baselineCount: run.evaluation.baselineCount,
            counts,
            truncated: run.evaluation.changes.truncated,
            changes: run.evaluation.changes.items
              .slice(0, 5)
              .map(({ jobId, kind }) => ({ jobId, kind })),
            deliveryStatus: run.delivery?.status ?? null,
          },
          facts: [{ key: "changes_total", value: run.evaluation.changes.total }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide one saved search ID from get_saved_alerts.",
        );
      }
    },
  };

  return [getSavedAlerts, setJobAlertState, openSavedSearch, getLatestSearchUpdate];
}
