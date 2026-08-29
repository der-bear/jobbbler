import { z } from "zod";

import { DomainError } from "@jobbbler/core-domain";

export const sourceKeySchema = z.enum(["jobicy", "remoteok", "arbeitnow"]);
export const sourcePurposeSchema = z.enum(["job_discovery", "saved_search_delivery", "evaluation"]);

const reviewedLocations = {
  jobicy: {
    sourceUrl: "https://jobicy.com/api/v2/remote-jobs",
    termsUrl: "https://jobicy.com/jobs-rss-feed",
    attributionUrl: "https://jobicy.com/",
  },
  remoteok: {
    sourceUrl: "https://remoteok.com/api",
    termsUrl: "https://remoteok.com/legal",
    attributionUrl: "https://remoteok.com/remote-jobs",
  },
  arbeitnow: {
    sourceUrl: "https://www.arbeitnow.com/api/job-board-api",
    termsUrl: "https://www.arbeitnow.com/terms",
    attributionUrl: "https://www.arbeitnow.com/",
  },
} as const;

export const sourcePolicySchema = z
  .strictObject({
    version: z.literal(1),
    sourceKey: sourceKeySchema,
    enabled: z.boolean(),
    allowedPurposes: z.array(sourcePurposeSchema).min(1).max(3),
    minimumPollIntervalSeconds: z.number().int().min(3_600).max(604_800),
    requestTimeoutMs: z.number().int().min(1_000).max(30_000),
    maxResponseBytes: z.number().int().min(1_024).max(5_000_000),
    maxRecords: z.number().int().min(1).max(500),
    rawPayloadRetentionDays: z.number().int().min(0).max(30),
    redistribution: z.enum(["attributed_excerpt", "attributed_metadata_only"]),
    commercialUse: z.enum(["allowed_with_attribution", "requires_permission", "undocumented"]),
    attribution: z.strictObject({
      label: z.string().trim().min(1).max(80),
      url: z.url(),
      required: z.boolean(),
      followedLinkRequired: z.boolean(),
    }),
    sourceUrl: z.url(),
    termsUrl: z.url(),
    userAgent: z.string().trim().min(12).max(200),
    notes: z.string().trim().min(1).max(500),
  })
  .superRefine((policy, context) => {
    const reviewed = reviewedLocations[policy.sourceKey];
    for (const [path, actual, expected] of [
      ["sourceUrl", policy.sourceUrl, reviewed.sourceUrl],
      ["termsUrl", policy.termsUrl, reviewed.termsUrl],
      ["attribution", policy.attribution.url, reviewed.attributionUrl],
    ] as const) {
      if (actual !== expected) {
        context.addIssue({
          code: "custom",
          path: path === "attribution" ? ["attribution", "url"] : [path],
          message: `Expected the reviewed ${policy.sourceKey} ${path}.`,
        });
      }
    }
  });

export type SourceKey = z.infer<typeof sourceKeySchema>;
export type SourcePurpose = z.infer<typeof sourcePurposeSchema>;
export type SourcePolicy = z.infer<typeof sourcePolicySchema>;

function parseInstant(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new DomainError({ code: "VALIDATION", message: `${label} must be an ISO instant.` });
  }
  return timestamp;
}

export function getNextAllowedAt(policy: SourcePolicy, lastAttemptAt: string): string {
  const timestamp = parseInstant(lastAttemptAt, "Last source attempt");
  return new Date(timestamp + policy.minimumPollIntervalSeconds * 1_000).toISOString();
}

export function assertSourceFetchAllowed(
  policyInput: SourcePolicy,
  purpose: SourcePurpose,
  now: string,
  lastAttemptAt: string | null,
): void {
  const policy = sourcePolicySchema.parse(policyInput);
  const nowTimestamp = parseInstant(now, "Current time");

  if (!policy.enabled) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: `${policy.attribution.label} ingestion is disabled by source policy.`,
    });
  }
  if (!policy.allowedPurposes.includes(purpose)) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: `Source policy does not allow ${purpose.replaceAll("_", " ")}.`,
    });
  }
  if (lastAttemptAt === null) return;

  const nextAllowedAt = getNextAllowedAt(policy, lastAttemptAt);
  if (nowTimestamp < Date.parse(nextAllowedAt)) {
    throw new DomainError({
      code: "RATE_LIMITED",
      message: `${policy.attribution.label} cannot be polled again before ${nextAllowedAt}.`,
      retryable: true,
      details: { nextAllowedAt },
    });
  }
}
