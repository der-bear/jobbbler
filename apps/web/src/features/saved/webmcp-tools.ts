import { z } from "zod";

import {
  entityIdSchema,
  type JobAlertSchedule,
  type SavedSearch,
  type SetJobAlertEnabledInput,
} from "@jobbbler/contracts";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

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

export interface SavedToolDependencies {
  listSavedSearches(options: Readonly<{ signal: AbortSignal }>): Promise<readonly SavedSearch[]>;
  listSchedules(options: Readonly<{ signal: AbortSignal }>): Promise<readonly JobAlertSchedule[]>;
  setScheduleEnabled(
    scheduleId: string,
    input: SetJobAlertEnabledInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<JobAlertSchedule>;
  onScheduleCommitted(schedule: JobAlertSchedule): Promise<void> | void;
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

  return [getSavedAlerts, setJobAlertState];
}
