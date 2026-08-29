import { z } from "zod";

import { apiErrorCodeSchema } from "./api.js";
import { entityIdSchema } from "./common.js";

export const toolNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(30);
export const toolDescriptionSchema = z.string().trim().min(1).max(500);
export const toolParameterDescriptionSchema = z.string().trim().min(1).max(150);

export const toolUserActionSchema = z.strictObject({
  kind: z.enum([
    "agent_authorization",
    "data_consent",
    "action_confirmation",
    "identity_verification",
  ]),
  surface: z.enum([
    "application_authorization",
    "data_consent",
    "application_review",
    "identity_verification",
  ]),
});

const summarySchema = z.string().trim().min(1).max(1_500);

export const toolSafeErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string().trim().min(1).max(500),
  requestId: entityIdSchema,
  retryable: z.boolean(),
});

export const toolResourceReferenceSchema = z.strictObject({
  type: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  id: entityIdSchema,
  label: z.string().trim().min(1).max(160),
});

export const toolFactSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  value: z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]),
});

const completedToolResultSchema = z.strictObject({
  status: z.literal("completed"),
  summary: summarySchema,
  resources: z.array(toolResourceReferenceSchema).max(50).optional(),
  facts: z.array(toolFactSchema).max(50).optional(),
  activityId: entityIdSchema.optional(),
});

const requiresUserActionToolResultSchema = z.strictObject({
  status: z.literal("requires_user_action"),
  summary: summarySchema,
  requestId: entityIdSchema,
  userAction: toolUserActionSchema,
  activityId: entityIdSchema.optional(),
});

const cancelledToolResultSchema = z.strictObject({
  status: z.literal("cancelled"),
  summary: summarySchema,
  activityId: entityIdSchema.optional(),
});

const failedToolResultSchema = z.strictObject({
  status: z.literal("failed"),
  summary: summarySchema,
  error: toolSafeErrorSchema,
  activityId: entityIdSchema.optional(),
});

export const toolExecutionResultSchema = z.discriminatedUnion("status", [
  completedToolResultSchema,
  requiresUserActionToolResultSchema,
  cancelledToolResultSchema,
  failedToolResultSchema,
]);

export function toolExecutionResultSchemaFor<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z.discriminatedUnion("status", [
    completedToolResultSchema.extend({ data: dataSchema }),
    requiresUserActionToolResultSchema,
    cancelledToolResultSchema,
    failedToolResultSchema,
  ]);
}

export const toolActivitySchema = z.strictObject({
  id: entityIdSchema,
  toolName: toolNameSchema,
  status: z.enum(["running", "completed", "requires_user_action", "failed", "cancelled"]),
  safeSummary: z.string().trim().min(1).max(240),
  correlationId: entityIdSchema,
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  affectedResourceIds: z.array(entityIdSchema).max(20),
});

export type ToolExecutionResult = z.infer<typeof toolExecutionResultSchema>;
export type ToolActivity = z.infer<typeof toolActivitySchema>;
