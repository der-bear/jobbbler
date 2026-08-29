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
import { createRawSourceRecord, normalizeListing, toHttpsUrl } from "../normalize.js";
import type { SourcePolicy } from "../policy.js";
import { fetchBoundedJson } from "../runtime.js";

const REMOTE_OK_PARTITION = "default";

type RemoteOkRow = Record<string, unknown>;

function pageDrift(message: string): DomainError {
  return new DomainError({
    code: "DEPENDENCY",
    message: `Remote OK response schema drift: ${message}`,
    retryable: false,
  });
}

function asRecord(value: unknown): RemoteOkRow | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RemoteOkRow)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stableExternalId(row: RemoteOkRow, originalUrl: string): string | null {
  if (typeof row["id"] === "number" && Number.isSafeInteger(row["id"]) && row["id"] >= 0) {
    return String(row["id"]);
  }
  const id = nonEmptyString(row["id"]);
  if (id !== null) return id.slice(0, 200);
  const slug = nonEmptyString(row["slug"]);
  if (slug !== null) return slug.slice(0, 200);
  return originalUrl;
}

function sourceUpdatedAt(row: RemoteOkRow): string | null {
  const date = nonEmptyString(row["date"]);
  if (date !== null && !Number.isNaN(Date.parse(date)))
    return new Date(Date.parse(date)).toISOString();

  if (typeof row["epoch"] === "number" && Number.isFinite(row["epoch"])) {
    const timestamp = row["epoch"] * 1_000;
    if (!Number.isNaN(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
  }
  return null;
}

function tagsFrom(row: RemoteOkRow): readonly string[] | null {
  if (!Array.isArray(row["tags"]) || !row["tags"].every((tag) => typeof tag === "string")) {
    return null;
  }
  return row["tags"];
}

function boundedLimit(input: FetchPartitionInput, policy: SourcePolicy): number {
  if (!Number.isFinite(input.limit)) return 0;
  return Math.min(policy.maxRecords, Math.max(0, Math.floor(input.limit)));
}

function rawRecordFromRow(
  row: unknown,
  input: FetchPartitionInput,
  policy: SourcePolicy,
): RawSourceRecord | null {
  const payload = asRecord(row);
  if (payload === null) return null;

  const originalUrl = toHttpsUrl(payload["url"]) ?? toHttpsUrl(payload["apply_url"]);
  if (originalUrl === null) return null;
  const applyUrl = toHttpsUrl(payload["apply_url"]) ?? originalUrl;
  const externalId = stableExternalId(payload, originalUrl);
  if (externalId === null) return null;

  return createRawSourceRecord({
    policy,
    partition: input.partition,
    externalId,
    originalUrl,
    applyUrl,
    sourceUpdatedAt: sourceUpdatedAt(payload),
    fetchedAt: input.fetchedAt,
    payload,
  });
}

function normalizeRemoteOkRecord(record: RawSourceRecord): NormalizationResult {
  const row = asRecord(record.payload);
  if (row === null) {
    return {
      accepted: false,
      reason: "invalid_record",
      validationIssues: ["Remote OK raw payload is not an object."],
    };
  }
  const tags = tagsFrom(row);
  if (tags === null) {
    return {
      accepted: false,
      reason: "invalid_record",
      validationIssues: ["Remote OK listing tags must be an array of strings."],
    };
  }

  // Remote OK does not provide a documented ISO 4217 currency for these values.
  // Do not guess USD (or another currency) from salary amounts alone.
  const salary: SalaryRange | null = null;
  const location = nonEmptyString(row["location"]) ?? "Remote";

  return normalizeListing({
    record,
    companyName: row["company"],
    title: row["position"],
    summaryHtml: row["description"],
    categorySignals: tags,
    workModel: "remote",
    employmentSignals: tags,
    senioritySignals: tags,
    locations: [location],
    salary,
    publishedAt: record.sourceUpdatedAt,
  });
}

export function createRemoteOkConnector({ policy, fetch }: ConnectorDependencies): JobConnector {
  if (policy.sourceKey !== "remoteok") {
    throw new DomainError({
      code: "VALIDATION",
      message: "Remote OK connector requires a remoteok source policy.",
    });
  }

  return {
    descriptor: {
      key: "remoteok",
      label: "Remote OK",
      partitions: [REMOTE_OK_PARTITION],
      actionCapability: "external_only",
      conditionalRequests: "undocumented",
    },
    policy,
    async *fetchPartition(
      input: FetchPartitionInput,
      signal: AbortSignal,
    ): AsyncGenerator<RawSourceRecord, FetchPartitionResult, void> {
      const response = await fetchBoundedJson(policy.sourceUrl, {
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
      if (!Array.isArray(response.body)) {
        throw pageDrift("expected the feed to be a JSON array.");
      }
      const metadata = asRecord(response.body[0]);
      if (metadata === null || nonEmptyString(metadata["legal"]) === null) {
        throw pageDrift("expected the first array element to contain legal metadata.");
      }

      const maximumRecords = boundedLimit(input, policy);
      const candidateRows = response.body.slice(1);
      let yielded = 0;
      let skippedRows = 0;
      for (const row of candidateRows) {
        if (yielded >= maximumRecords) break;
        const record = rawRecordFromRow(row, input, policy);
        if (record === null) {
          skippedRows += 1;
          continue;
        }
        yielded += 1;
        yield record;
      }

      return {
        complete: maximumRecords > 0 && candidateRows.length <= maximumRecords && skippedRows === 0,
        notModified: false,
        etag: response.etag,
        lastModified: response.lastModified,
        bytes: response.bytes,
        nextPage: null,
      };
    },
    normalize: normalizeRemoteOkRecord,
  };
}
