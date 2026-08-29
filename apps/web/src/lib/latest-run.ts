import { z } from "zod";

export const latestSearchRunSchema = z.strictObject({
  savedSearchId: z.string(),
  evaluation: z
    .strictObject({
      id: z.string(),
      createdAt: z.iso.datetime({ offset: true }),
      catalogUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
      baselineCount: z.number().int().nonnegative(),
      changes: z.strictObject({
        total: z.number().int().nonnegative(),
        truncated: z.boolean(),
        items: z.array(
          z.strictObject({
            id: z.string(),
            jobId: z.string(),
            kind: z.enum(["new", "updated", "closed", "no_longer_matching"]),
            createdAt: z.iso.datetime({ offset: true }),
          }),
        ),
      }),
    })
    .nullable(),
  delivery: z
    .strictObject({
      status: z.enum(["pending", "sending", "accepted", "failed", "dead", "cancelled"]),
      attempt: z.number().int().nonnegative(),
      errorCode: z.string().nullable(),
      acceptedAt: z.iso.datetime({ offset: true }).nullable(),
      lastAttemptAt: z.iso.datetime({ offset: true }).nullable(),
      updatedAt: z.iso.datetime({ offset: true }),
    })
    .nullable(),
});

export type LatestSearchRun = z.infer<typeof latestSearchRunSchema>;
