import { z } from "zod";

import { entityIdSchema, isoInstantSchema } from "./common.js";
import { toolNameSchema } from "./webmcp.js";

const unsafeSummaryPatterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b(?:bearer|authorization)\s+[a-z0-9._~+/=-]+/iu,
  /\b(?:cookie|password|secret|token)\s*[:=]/iu,
  /https?:\/\//iu,
  /<\/?[a-z][^>]*>/iu,
  /\b[a-z][a-z0-9_]{0,30}_[0-9a-f]{8}-[0-9a-f-]{27,}\b/iu,
  /\b[a-z0-9_-]{32,}\b/iu,
] as const;

export const realtimeSafeSummarySchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .superRefine((value, context) => {
    if (unsafeSummaryPatterns.some((pattern) => pattern.test(value))) {
      context.addIssue({
        code: "custom",
        message:
          "Realtime summaries must not contain identifiers, credentials, URLs, or raw content.",
      });
    }
  });

export const ownerActivityEventSchema = z.strictObject({
  id: entityIdSchema,
  schemaVersion: z.literal(1),
  kind: z.enum([
    "tool",
    "authorization",
    "consent",
    "application",
    "saved_search",
    "schedule",
    "source_health",
  ]),
  key: toolNameSchema,
  status: z.enum(["running", "completed", "requires_user_action", "failed", "cancelled"]),
  safeSummary: realtimeSafeSummarySchema,
  correlationId: entityIdSchema,
  actorKind: z.enum(["human", "agent", "service"]),
  aggregate: z.strictObject({
    type: z.enum(["application_draft", "saved_search", "schedule", "source", "system"]),
    version: z.number().int().nonnegative(),
  }),
  occurredAt: isoInstantSchema,
  effects: z
    .array(
      z.strictObject({
        target: z.enum(["agent_activity", "application", "saved_searches", "search_results"]),
        kind: z.enum(["refresh", "highlight", "announce", "focus"]),
      }),
    )
    .max(4),
});

export const ownerActivityPageSchema = z.strictObject({
  events: z.array(ownerActivityEventSchema).max(100),
  nextCursor: z.string().min(1).max(160).nullable(),
  hasMore: z.boolean(),
  resyncRequired: z.boolean(),
  pollAfterMs: z.number().int().min(1_000).max(30_000),
});

export type OwnerActivityEvent = z.infer<typeof ownerActivityEventSchema>;
export type OwnerActivityPage = z.infer<typeof ownerActivityPageSchema>;
