import { z } from "zod";

import { DomainError } from "@jobbbler/core-domain";

import type {
  ConnectorDependencies,
  FetchPartitionInput,
  FetchPartitionResult,
  JobConnector,
  NormalizationResult,
  RawSourceRecord,
} from "../contracts.js";
import { createRawSourceRecord, normalizeListing, toHttpsUrl } from "../normalize.js";
import { type SourcePolicy } from "../policy.js";
import { fetchBoundedJson } from "../runtime.js";

const jobicyPageSchema = z.object({
  apiVersion: z.string(),
  status: z.literal("success"),
  jobCount: z.number().int().nonnegative(),
  jobs: z.array(z.unknown()),
});

const jobicyListingSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  url: z.string(),
  jobTitle: z.string(),
  companyName: z.string(),
  companyUrl: z.string().nullable().optional(),
  jobGeo: z.string().nullable().optional(),
  jobType: z
    .union([z.string(), z.array(z.string())])
    .nullable()
    .optional(),
  jobLevel: z.string().nullable().optional(),
  jobExcerpt: z.string().nullable().optional(),
  jobDescription: z.string().nullable().optional(),
  pubDate: z.string().nullable().optional(),
  annualSalaryMin: z.number().finite().nonnegative().nullable().optional(),
  annualSalaryMax: z.number().finite().nonnegative().nullable().optional(),
  salaryMin: z.number().finite().nonnegative().nullable().optional(),
  salaryMax: z.number().finite().nonnegative().nullable().optional(),
  salaryCurrency: z.string().nullable().optional(),
  jobIndustry: z.array(z.string()).nullable().optional(),
  jobFunction: z.array(z.string()).nullable().optional(),
  jobBenefits: z.array(z.string()).nullable().optional(),
});

interface JobicyConnectorOptions extends ConnectorDependencies {
  readonly policy: SourcePolicy;
}

function dependencySchemaError(message: string): DomainError {
  return new DomainError({ code: "DEPENDENCY", message, retryable: false });
}

function externalIdFrom(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as Record<string, unknown>)["id"];
  if ((typeof id !== "string" && typeof id !== "number") || String(id).trim().length === 0) {
    return null;
  }
  return String(id).trim();
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function optionalInstant(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(Date.parse(value)).toISOString();
}

function salaryFrom(listing: z.infer<typeof jobicyListingSchema>) {
  const minimum = listing.salaryMin ?? listing.annualSalaryMin ?? null;
  const maximum = listing.salaryMax ?? listing.annualSalaryMax ?? null;
  const currency = listing.salaryCurrency?.trim().toUpperCase();
  if (minimum === null && maximum === null) return null;
  if (currency === undefined || !/^[A-Z]{3}$/u.test(currency)) return null;
  return { minimum, maximum, currency, period: "year" as const };
}

function jobTypesFrom(value: z.infer<typeof jobicyListingSchema>["jobType"]): string[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function createRawRecord(
  policy: SourcePolicy,
  input: FetchPartitionInput,
  payload: unknown,
  externalId: string,
): RawSourceRecord {
  const values = payload as Record<string, unknown>;
  const originalUrl = stringField(values["url"], policy.sourceUrl);
  return createRawSourceRecord({
    policy,
    partition: input.partition,
    externalId,
    originalUrl,
    applyUrl: originalUrl,
    sourceUpdatedAt: optionalInstant(values["pubDate"]),
    fetchedAt: input.fetchedAt,
    payload,
  });
}

function normalizeJobicyRecord(record: RawSourceRecord): NormalizationResult {
  const parsed = jobicyListingSchema.safeParse(record.payload);
  if (!parsed.success) {
    return {
      accepted: false,
      reason: "invalid_record",
      validationIssues: parsed.error.issues.map((issue) => issue.message).slice(0, 8),
    };
  }

  const listing = parsed.data;
  const description = listing.jobDescription ?? listing.jobExcerpt ?? "";
  const location = listing.jobGeo?.trim() || "Remote";
  const signals = [
    ...(listing.jobIndustry ?? []),
    ...(listing.jobFunction ?? []),
    ...(listing.jobBenefits ?? []),
  ];
  return normalizeListing({
    record,
    companyName: listing.companyName,
    companyWebsite: listing.companyUrl,
    title: listing.jobTitle,
    summaryHtml: description,
    categorySignals: signals,
    workModel: "remote",
    employmentSignals: jobTypesFrom(listing.jobType),
    senioritySignals: [listing.jobLevel ?? ""],
    locations: [location],
    salary: salaryFrom(listing),
    publishedAt: optionalInstant(listing.pubDate),
  });
}

export function createJobicyConnector(options: JobicyConnectorOptions): JobConnector {
  const { policy, fetch } = options;
  if (policy.sourceKey !== "jobicy") {
    throw new DomainError({
      code: "VALIDATION",
      message: "Jobicy connector requires a jobicy source policy.",
    });
  }

  return {
    descriptor: {
      key: "jobicy",
      label: policy.attribution.label,
      partitions: ["default"],
      actionCapability: "external_only",
      conditionalRequests: "undocumented",
    },
    policy,
    async *fetchPartition(input, signal) {
      const limit = Math.min(input.limit, policy.maxRecords);
      const url = new URL(policy.sourceUrl);
      url.searchParams.set("count", String(limit));
      const response = await fetchBoundedJson(url.toString(), {
        policy,
        fetch,
        signal,
        etag: input.etag,
        lastModified: input.lastModified,
      });

      if (response.notModified) {
        return {
          complete: true,
          notModified: true,
          etag: response.etag,
          lastModified: response.lastModified,
          bytes: response.bytes,
          nextPage: null,
        } satisfies FetchPartitionResult;
      }

      const page = jobicyPageSchema.safeParse(response.body);
      if (!page.success) {
        throw dependencySchemaError("Jobicy response did not match the expected page structure.");
      }

      for (const payload of page.data.jobs.slice(0, limit)) {
        const externalId = externalIdFrom(payload);
        if (externalId === null) continue;
        yield createRawRecord(policy, input, payload, externalId);
      }

      return {
        complete: limit > 0 && page.data.jobs.length < limit,
        notModified: false,
        etag: response.etag,
        lastModified: response.lastModified,
        bytes: response.bytes,
        nextPage: null,
      } satisfies FetchPartitionResult;
    },
    normalize(record) {
      if (record.sourceKey !== policy.sourceKey || record.actionCapability !== "external_only") {
        return {
          accepted: false,
          reason: "invalid_record",
          validationIssues: ["Raw record does not belong to this connector."],
        };
      }
      if (toHttpsUrl(record.originalUrl) === null) {
        return {
          accepted: false,
          reason: "invalid_record",
          validationIssues: ["Jobicy listing URL must use HTTPS."],
        };
      }
      return normalizeJobicyRecord(record);
    },
  };
}
