import { z } from "zod";

import { entityIdSchema, isoInstantSchema } from "./common.js";
import { jobSearchCriteriaSchema } from "./search.js";

export const weekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a 24-hour HH:mm time.");

export const timeZoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "Expected an IANA time zone.");

const uniqueWeekdaysSchema = z
  .array(weekdaySchema)
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, {
    message: "Weekly schedule days must be unique.",
  });

export const scheduleRecurrenceSchema = z.discriminatedUnion("frequency", [
  z.strictObject({
    frequency: z.literal("daily"),
    time: localTimeSchema,
    timeZone: timeZoneSchema,
  }),
  z.strictObject({
    frequency: z.literal("weekly"),
    time: localTimeSchema,
    timeZone: timeZoneSchema,
    days: uniqueWeekdaysSchema,
  }),
]);

export const createSavedSearchInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  criteria: jobSearchCriteriaSchema,
});

export const scheduleJobAlertInputSchema = z.strictObject({
  savedSearchId: entityIdSchema,
  expectedVersion: z.number().int().nonnegative(),
  recurrence: scheduleRecurrenceSchema,
  delivery: z.strictObject({
    channel: z.literal("email"),
    endpointId: entityIdSchema,
  }),
});

export const savedSearchSchema = z.strictObject({
  id: entityIdSchema,
  ownerId: entityIdSchema,
  name: z.string().trim().min(1).max(100),
  criteria: jobSearchCriteriaSchema,
  version: z.number().int().nonnegative(),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});

export const jobAlertScheduleSchema = z.strictObject({
  id: entityIdSchema,
  ownerId: entityIdSchema,
  savedSearchId: entityIdSchema,
  recurrence: scheduleRecurrenceSchema,
  delivery: z.strictObject({
    channel: z.literal("email"),
    endpointId: entityIdSchema,
  }),
  enabled: z.boolean(),
  nextRunAt: isoInstantSchema,
  version: z.number().int().nonnegative(),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});

export const setJobAlertEnabledInputSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  enabled: z.boolean(),
});

export const updateJobAlertScheduleInputSchema = z
  .strictObject({
    expectedVersion: z.number().int().nonnegative(),
    recurrence: scheduleRecurrenceSchema.optional(),
    delivery: z
      .strictObject({
        channel: z.literal("email"),
        endpointId: entityIdSchema,
      })
      .optional(),
  })
  .refine((input) => input.recurrence !== undefined || input.delivery !== undefined, {
    message: "Provide a recurrence or delivery change.",
  });

export type ScheduleRecurrence = z.infer<typeof scheduleRecurrenceSchema>;
export type Weekday = z.infer<typeof weekdaySchema>;
export type SavedSearch = z.infer<typeof savedSearchSchema>;
export type JobAlertSchedule = z.infer<typeof jobAlertScheduleSchema>;
export type ScheduleJobAlertInput = z.infer<typeof scheduleJobAlertInputSchema>;
export type SetJobAlertEnabledInput = z.infer<typeof setJobAlertEnabledInputSchema>;
export type UpdateJobAlertScheduleInput = z.infer<typeof updateJobAlertScheduleInputSchema>;
