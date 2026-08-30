import {
  createSavedSearchInputSchema,
  scheduleJobAlertInputSchema,
  setJobAlertEnabledInputSchema,
  updateJobAlertScheduleInputSchema,
  type JobAlertSchedule,
  type SavedSearch,
} from "@jobbbler/contracts";

import { DomainError } from "../errors.js";
import type { VerificationEndpointRecord } from "../ownership/types.js";
import { calculateNextRun, deriveEvaluationJitterSeconds } from "../schedules/schedule.js";

export interface SavedSearchServicePorts {
  readonly savedSearches: {
    insert(record: SavedSearch): Promise<SavedSearch>;
    getById(id: string): Promise<SavedSearch | null>;
    listByOwner(ownerId: string): Promise<SavedSearch[]>;
    delete(id: string): Promise<boolean>;
  };
  readonly schedules: {
    insert(record: JobAlertSchedule): Promise<JobAlertSchedule>;
    getById(id: string): Promise<JobAlertSchedule | null>;
    listByOwner(ownerId: string): Promise<JobAlertSchedule[]>;
    update(record: JobAlertSchedule, expectedVersion: number): Promise<JobAlertSchedule>;
  };
  readonly endpoints: {
    getVerificationEndpoint(
      ownerId: string,
      endpointId: string,
    ): Promise<VerificationEndpointRecord | null>;
  };
  readonly ids: {
    savedSearch(): string;
    schedule(): string;
  };
}

const EVALUATION_JITTER_MAX_SECONDS = 120;

function addSeconds(instant: string, seconds: number): string {
  return new Date(Date.parse(instant) + seconds * 1_000).toISOString();
}

function alertNextRun(
  savedSearchId: string,
  recurrence: JobAlertSchedule["recurrence"],
  now: string,
) {
  return addSeconds(
    calculateNextRun(recurrence, now),
    deriveEvaluationJitterSeconds(savedSearchId, EVALUATION_JITTER_MAX_SECONDS),
  );
}

async function requireOwnedSearch(
  ports: SavedSearchServicePorts,
  ownerId: string,
  savedSearchId: string,
): Promise<SavedSearch> {
  const saved = await ports.savedSearches.getById(savedSearchId);
  if (saved === null)
    throw new DomainError({ code: "NOT_FOUND", message: "Saved search was not found." });
  if (saved.ownerId !== ownerId)
    throw new DomainError({ code: "FORBIDDEN", message: "Saved search belongs to another owner." });
  return saved;
}

async function requireOwnedSchedule(
  ports: SavedSearchServicePorts,
  ownerId: string,
  scheduleId: string,
  expectedVersion: number,
): Promise<JobAlertSchedule> {
  const schedule = await ports.schedules.getById(scheduleId);
  if (schedule === null)
    throw new DomainError({ code: "NOT_FOUND", message: "Job alert was not found." });
  if (schedule.ownerId !== ownerId)
    throw new DomainError({
      code: "FORBIDDEN",
      message: "Job alert belongs to another owner.",
    });
  if (schedule.version !== expectedVersion)
    throw new DomainError({
      code: "CONFLICT",
      message: "Job alert changed before this action.",
    });
  return schedule;
}

async function requireVerifiedEndpoint(
  ports: SavedSearchServicePorts,
  ownerId: string,
  endpointId: string,
): Promise<VerificationEndpointRecord> {
  const endpoint = await ports.endpoints.getVerificationEndpoint(ownerId, endpointId);
  if (endpoint === null || endpoint.status !== "verified") {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "Choose a verified delivery destination.",
    });
  }
  return endpoint;
}

export function createSavedSearchService(ports: SavedSearchServicePorts) {
  async function previewSchedule(ownerId: string, rawInput: unknown, now: string) {
    const input = scheduleJobAlertInputSchema.parse(rawInput);
    const saved = await requireOwnedSearch(ports, ownerId, input.savedSearchId);
    if (saved.version !== input.expectedVersion)
      throw new DomainError({ code: "CONFLICT", message: "Saved search changed before preview." });
    const endpoint = await requireVerifiedEndpoint(ports, ownerId, input.delivery.endpointId);
    return {
      recurrence: input.recurrence,
      nextRunAt: alertNextRun(saved.id, input.recurrence, now),
      delivery: {
        channel: "email" as const,
        endpointId: endpoint.id,
        maskedDestination: endpoint.maskedAddress,
      },
    };
  }

  return {
    async createSavedSearch(ownerId: string, rawInput: unknown, now: string): Promise<SavedSearch> {
      const input = createSavedSearchInputSchema.parse(rawInput);
      return ports.savedSearches.insert({
        id: ports.ids.savedSearch(),
        ownerId,
        name: input.name,
        criteria: { ...input.criteria, cursor: null },
        version: 0,
        createdAt: now,
        updatedAt: now,
      });
    },

    listSavedSearches(ownerId: string): Promise<SavedSearch[]> {
      return ports.savedSearches.listByOwner(ownerId);
    },

    previewSchedule,

    async scheduleAlert(
      ownerId: string,
      rawInput: unknown,
      now: string,
    ): Promise<JobAlertSchedule> {
      const input = scheduleJobAlertInputSchema.parse(rawInput);
      const preview = await previewSchedule(ownerId, input, now);
      const existing = (await ports.schedules.listByOwner(ownerId)).find(
        ({ savedSearchId }) => savedSearchId === input.savedSearchId,
      );
      if (existing !== undefined) {
        const identical =
          existing.delivery.channel === input.delivery.channel &&
          existing.delivery.endpointId === input.delivery.endpointId &&
          JSON.stringify(existing.recurrence) === JSON.stringify(input.recurrence);
        if (identical) return existing;
        throw new DomainError({
          code: "CONFLICT",
          message:
            "This saved search already has an alert. Edit or remove it before replacing the schedule.",
        });
      }
      return ports.schedules.insert({
        id: ports.ids.schedule(),
        ownerId,
        savedSearchId: input.savedSearchId,
        recurrence: input.recurrence,
        delivery: { channel: "email", endpointId: input.delivery.endpointId },
        enabled: true,
        nextRunAt: preview.nextRunAt,
        version: 0,
        createdAt: now,
        updatedAt: now,
      });
    },

    listSchedules(ownerId: string): Promise<JobAlertSchedule[]> {
      return ports.schedules.listByOwner(ownerId);
    },

    async setScheduleEnabled(
      ownerId: string,
      scheduleId: string,
      rawInput: unknown,
      now: string,
    ): Promise<JobAlertSchedule> {
      const input = setJobAlertEnabledInputSchema.parse(rawInput);
      const schedule = await requireOwnedSchedule(
        ports,
        ownerId,
        scheduleId,
        input.expectedVersion,
      );
      const next: JobAlertSchedule = {
        ...schedule,
        enabled: input.enabled,
        nextRunAt: input.enabled
          ? alertNextRun(schedule.savedSearchId, schedule.recurrence, now)
          : schedule.nextRunAt,
        updatedAt: now,
      };
      return ports.schedules.update(next, input.expectedVersion);
    },

    async updateSchedule(
      ownerId: string,
      scheduleId: string,
      rawInput: unknown,
      now: string,
    ): Promise<JobAlertSchedule> {
      const input = updateJobAlertScheduleInputSchema.parse(rawInput);
      const schedule = await requireOwnedSchedule(
        ports,
        ownerId,
        scheduleId,
        input.expectedVersion,
      );
      const delivery =
        input.delivery === undefined
          ? schedule.delivery
          : {
              channel: "email" as const,
              endpointId: (await requireVerifiedEndpoint(ports, ownerId, input.delivery.endpointId))
                .id,
            };
      const recurrence = input.recurrence ?? schedule.recurrence;
      const next: JobAlertSchedule = {
        ...schedule,
        recurrence,
        delivery,
        nextRunAt:
          input.recurrence === undefined
            ? schedule.nextRunAt
            : alertNextRun(schedule.savedSearchId, recurrence, now),
        updatedAt: now,
      };
      return ports.schedules.update(next, input.expectedVersion);
    },

    async deleteSavedSearch(
      ownerId: string,
      savedSearchId: string,
    ): Promise<{
      readonly savedSearch: SavedSearch;
      readonly schedule: JobAlertSchedule | null;
    }> {
      const saved = await requireOwnedSearch(ports, ownerId, savedSearchId);
      const schedule =
        (await ports.schedules.listByOwner(ownerId)).find(
          (candidate) => candidate.savedSearchId === saved.id,
        ) ?? null;
      const deleted = await ports.savedSearches.delete(saved.id);
      if (!deleted)
        throw new DomainError({ code: "NOT_FOUND", message: "Saved search was not found." });
      return { savedSearch: saved, schedule };
    },
  };
}
