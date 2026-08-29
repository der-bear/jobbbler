import { z } from "zod";

import { entityIdSchema } from "./common.js";

export const apiErrorCodeSchema = z.enum([
  "VALIDATION",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "DEPENDENCY",
  "CANCELLED",
  "INTERNAL",
]);

export const apiErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string().trim().min(1).max(500),
  requestId: entityIdSchema,
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const apiMetaSchema = z.strictObject({
  requestId: entityIdSchema,
  durationMs: z.number().int().nonnegative().optional(),
});

export function apiResponseSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z.discriminatedUnion("ok", [
    z.strictObject({
      ok: z.literal(true),
      data: dataSchema,
      meta: apiMetaSchema.optional(),
    }),
    z.strictObject({
      ok: z.literal(false),
      error: apiErrorSchema,
    }),
  ]);
}

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiResponse<T> =
  { ok: true; data: T; meta?: z.infer<typeof apiMetaSchema> } | { ok: false; error: ApiError };
