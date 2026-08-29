import { z } from "zod";

import { DomainError } from "@jobbbler/core-domain";
import type { SalaryRange } from "@jobbbler/contracts";

import type {
  ConnectorDependencies,
  FetchPartitionInput,
  FetchPartitionResult,
  JobConnector,
  NormalizationResult,
  RawSourceRecord,
} from "../contracts.js";
import { createRawSourceRecord, normalizeListing } from "../normalize.js";
import type { SourcePolicy } from "../policy.js";
import { fetchBoundedJson } from "../runtime.js";

const ARBEITNOW_PARTITION = "default";

const httpsUrlSchema = z.url().refine((value) => new URL(value).protocol === "https:", {
  message: "Expected an HTTPS URL.",
});

function nonBlankString(maximumLength: number) {
  return z
    .string()
    .min(1)
    .max(maximumLength)
    .refine((value) => value.trim().length > 0, { message: "Expected a non-blank string." });
}

const listingSchema = z
  .object({
    slug: nonBlankString(200),
    company_name: nonBlankString(500),
    title: nonBlankString(500),
    description: z.string().min(1).max(200_000),
    remote: z.boolean(),
    url: httpsUrlSchema,
    tags: z.array(nonBlankString(160)).max(100),
    job_types: z.array(nonBlankString(80)).max(20),
    location: nonBlankString(500),
    created_at: z.number().int().min(0).max(8_640_000_000),
  })
  .passthrough();

const paginationLinkSchema = z
  .object({
    url: z.url().nullable(),
    label: z.string(),
    active: z.boolean(),
  })
  .passthrough();

const pageSchema = z
  .object({
    data: z.array(listingSchema),
    links: z
      .object({
        first: httpsUrlSchema,
        last: httpsUrlSchema.nullable(),
        prev: httpsUrlSchema.nullable(),
        next: httpsUrlSchema.nullable(),
      })
      .passthrough(),
    meta: z
      .object({
        current_page: z.number().int().min(1),
        current_page_url: httpsUrlSchema.optional(),
        from: z.number().int().min(1).nullable(),
        last_page: z.number().int().min(1).optional(),
        links: z.array(paginationLinkSchema).optional(),
        path: httpsUrlSchema,
        per_page: z.number().int().min(1),
        to: z.number().int().min(1).nullable(),
        total: z.number().int().min(0).optional(),
        terms: z.string().optional(),
        info: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough()
  .superRefine(({ meta }, context) => {
    if (meta.last_page !== undefined && meta.current_page > meta.last_page) {
      context.addIssue({
        code: "custom",
        path: ["meta", "current_page"],
        message: "current_page cannot exceed last_page.",
      });
    }
  });

type ArbeitnowListing = z.infer<typeof listingSchema>;
type ArbeitnowPage = z.infer<typeof pageSchema>;

function pageDrift(message: string): DomainError {
  return new DomainError({
    code: "DEPENDENCY",
    message: `Arbeitnow response schema drift: ${message}`,
    retryable: false,
  });
}

function boundedLimit(input: FetchPartitionInput, policy: SourcePolicy): number {
  if (!Number.isFinite(input.limit)) return 0;
  return Math.min(policy.maxRecords, Math.max(0, Math.floor(input.limit)));
}

function pageFromLink(value: string, label: string): number {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw pageDrift(`${label} is not a valid pagination URL.`);
  }
  const pages = url.searchParams.getAll("page");
  if (pages.length !== 1 || !/^[1-9]\d*$/u.test(pages[0] ?? "")) {
    throw pageDrift(`${label} must contain exactly one positive integer page parameter.`);
  }
  const page = Number(pages[0]);
  if (!Number.isSafeInteger(page)) {
    throw pageDrift(`${label} page parameter is out of range.`);
  }
  return page;
}

function getNextPage(page: ArbeitnowPage, requestedPage: number): number | null {
  const { links, meta } = page;
  if (meta.current_page !== requestedPage) {
    throw pageDrift("metadata current_page does not match the requested page.");
  }
  if (pageFromLink(links.first, "links.first") !== 1) {
    throw pageDrift("links.first must identify page 1.");
  }
  if (
    links.last !== null &&
    meta.last_page !== undefined &&
    pageFromLink(links.last, "links.last") !== meta.last_page
  ) {
    throw pageDrift("links.last does not match metadata last_page.");
  }

  const expectedPrevious = meta.current_page > 1 ? meta.current_page - 1 : null;
  if (
    (links.prev === null && expectedPrevious !== null) ||
    (links.prev !== null && pageFromLink(links.prev, "links.prev") !== expectedPrevious)
  ) {
    throw pageDrift("links.prev does not match metadata pagination.");
  }

  const nextPage = links.next === null ? null : pageFromLink(links.next, "links.next");
  if (nextPage !== null && nextPage !== meta.current_page + 1) {
    throw pageDrift("links.next does not match metadata pagination.");
  }
  if (meta.last_page !== undefined) {
    const expectedNext = meta.current_page < meta.last_page ? meta.current_page + 1 : null;
    if (nextPage !== expectedNext) {
      throw pageDrift("links.next does not match metadata last_page.");
    }
  }
  return nextPage;
}

function sourceUpdatedAt(row: ArbeitnowListing): string {
  return new Date(row.created_at * 1_000).toISOString();
}

function rawRecordFromRow(
  row: ArbeitnowListing,
  input: FetchPartitionInput,
  policy: SourcePolicy,
): RawSourceRecord {
  return createRawSourceRecord({
    policy,
    partition: input.partition,
    externalId: row.slug,
    originalUrl: row.url,
    applyUrl: row.url,
    sourceUpdatedAt: sourceUpdatedAt(row),
    fetchedAt: input.fetchedAt,
    payload: row,
  });
}

function normalizeArbeitnowRecord(record: RawSourceRecord): NormalizationResult {
  const parsed = listingSchema.safeParse(record.payload);
  if (!parsed.success) {
    return {
      accepted: false,
      reason: "invalid_record",
      validationIssues: ["Arbeitnow raw payload does not match the listing contract."],
    };
  }

  const row = parsed.data;
  // Arbeitnow does not supply an ISO 4217 currency with salary values. Never infer one.
  const salary: SalaryRange | null = null;
  return normalizeListing({
    record,
    companyName: row.company_name,
    title: row.title,
    summaryHtml: row.description,
    categorySignals: row.tags,
    workModel: row.remote ? "remote" : "onsite",
    employmentSignals: row.job_types,
    senioritySignals: row.tags,
    locations: [row.location],
    salary,
    publishedAt: sourceUpdatedAt(row),
  });
}

function sourcePageUrl(policy: SourcePolicy, page: number): string {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new DomainError({
      code: "VALIDATION",
      message: "Arbeitnow page must be a positive integer.",
    });
  }
  const url = new URL(policy.sourceUrl);
  url.searchParams.set("page", String(page));
  return url.toString();
}

export function createArbeitnowConnector({ policy, fetch }: ConnectorDependencies): JobConnector {
  if (policy.sourceKey !== "arbeitnow") {
    throw new DomainError({
      code: "VALIDATION",
      message: "Arbeitnow connector requires an arbeitnow source policy.",
    });
  }

  return {
    descriptor: {
      key: "arbeitnow",
      label: "Arbeitnow",
      partitions: [ARBEITNOW_PARTITION],
      actionCapability: "external_only",
      conditionalRequests: "undocumented",
    },
    policy,
    async *fetchPartition(
      input: FetchPartitionInput,
      signal: AbortSignal,
    ): AsyncGenerator<RawSourceRecord, FetchPartitionResult, void> {
      const response = await fetchBoundedJson(sourcePageUrl(policy, input.page), {
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
        };
      }

      const parsed = pageSchema.safeParse(response.body);
      if (!parsed.success) {
        throw pageDrift("outer page or a listing row no longer matches the documented contract.");
      }
      const nextPage = getNextPage(parsed.data, input.page);
      const maximumRecords = boundedLimit(input, policy);
      for (const row of parsed.data.data.slice(0, maximumRecords)) {
        yield rawRecordFromRow(row, input, policy);
      }

      return {
        complete:
          maximumRecords > 0 && nextPage === null && parsed.data.data.length <= maximumRecords,
        notModified: false,
        etag: response.etag,
        lastModified: response.lastModified,
        bytes: response.bytes,
        nextPage,
      };
    },
    normalize: normalizeArbeitnowRecord,
  };
}
