import { createHash } from "node:crypto";

import { jobSchema, type Job } from "@jobbbler/contracts";
import { DomainError } from "@jobbbler/core-domain";
import type {
  IngestionRepository,
  JobSourceLinkRecord,
  JobVersionRecord,
  OrganizationRecord,
  PersistSourceObservationInput,
  PersistSourceObservationResult,
  SourceNormalizationSummary,
  SourceRunRecord,
  SourceStateInput,
  SourceStateRecord,
  StoredSourceEvidence,
} from "@jobbbler/storage";

import type { SqliteDatabase } from "./connection.js";

interface SourceRunRow {
  readonly id: string;
  readonly source_key: string;
  readonly partition: string;
  readonly purpose: SourceRunRecord["purpose"];
  readonly status: SourceRunRecord["status"];
  readonly policy_version: number;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly complete: number | null;
  readonly not_modified: number;
  readonly pages_fetched: number;
  readonly records_fetched: number;
  readonly records_accepted: number;
  readonly records_rejected: number;
  readonly records_unchanged: number;
  readonly response_etag: string | null;
  readonly response_last_modified: string | null;
  readonly response_bytes: number;
  readonly error_code: string | null;
}

interface SourceStateRow {
  readonly source_key: string;
  readonly partition: string;
  readonly health: SourceStateRecord["health"];
  readonly last_attempt_at: string | null;
  readonly last_successful_at: string | null;
  readonly next_allowed_at: string;
  readonly consecutive_failures: number;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly policy_version: number;
  readonly version: number;
  readonly updated_at: string;
}

interface EvidenceRow {
  readonly id: string;
  readonly source_key: string;
  readonly partition: string;
  readonly external_id: string;
  readonly original_url: string;
  readonly apply_url: string;
  readonly source_updated_at: string | null;
  readonly first_fetched_at: string;
  readonly raw_hash: string;
  readonly policy_version: number;
  readonly attribution_label: string;
  readonly attribution_url: string;
  readonly attribution_required: number;
  readonly followed_link_required: number;
  readonly payload_json: string | null;
  readonly retained_until: string | null;
  readonly normalization_status: SourceNormalizationSummary["status"] | null;
  readonly normalization_reason: string | null;
  readonly issues_json: string | null;
  readonly normalizer_version: number | null;
  readonly normalized_hash: string | null;
  readonly normalization_recorded_at: string | null;
}

interface NormalizationRow {
  readonly id: string;
  readonly status: SourceNormalizationSummary["status"];
  readonly reason: string | null;
  readonly issues_json: string;
  readonly normalized_hash: string | null;
}

interface JobVersionRow {
  readonly id: string;
  readonly job_id: string;
  readonly source_record_id: string;
  readonly normalized_hash: string;
  readonly job_json: string;
  readonly observed_at: string;
}

interface JobSourceLinkRow {
  readonly job_id: string;
  readonly source_key: string;
  readonly partition: string;
  readonly external_id: string;
  readonly original_url: string;
  readonly apply_url: string;
  readonly identity_basis: "source_id";
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly status: JobSourceLinkRecord["status"];
  readonly missing_complete_runs: number;
  readonly last_complete_run_id: string | null;
  readonly latest_source_record_id: string;
  readonly latest_source_updated_at: string;
  readonly latest_raw_hash: string;
  readonly attribution_label: string;
  readonly attribution_url: string;
  readonly attribution_required: number;
  readonly followed_link_required: number;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new DomainError({ code: "VALIDATION", message: "Expected JSON-serializable data." });
  }
  return serialized;
}

function stableJson(value: unknown): string {
  return json(canonicalize(value));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${hash(value)}`;
}

function sourceRunFromRow(row: SourceRunRow): SourceRunRecord {
  return {
    id: row.id,
    sourceKey: row.source_key,
    partition: row.partition,
    purpose: row.purpose,
    status: row.status,
    policyVersion: row.policy_version,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    complete: row.complete === null ? null : row.complete === 1,
    notModified: row.not_modified === 1,
    pagesFetched: row.pages_fetched,
    recordsFetched: row.records_fetched,
    recordsAccepted: row.records_accepted,
    recordsRejected: row.records_rejected,
    recordsUnchanged: row.records_unchanged,
    responseEtag: row.response_etag,
    responseLastModified: row.response_last_modified,
    responseBytes: row.response_bytes,
    errorCode: row.error_code,
  };
}

function sourceStateFromRow(row: SourceStateRow): SourceStateRecord {
  return {
    sourceKey: row.source_key,
    partition: row.partition,
    health: row.health,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessfulAt: row.last_successful_at,
    nextAllowedAt: row.next_allowed_at,
    consecutiveFailures: row.consecutive_failures,
    etag: row.etag,
    lastModified: row.last_modified,
    policyVersion: row.policy_version,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function sourceLinkFromRow(row: JobSourceLinkRow): JobSourceLinkRecord {
  return {
    jobId: row.job_id,
    sourceKey: row.source_key,
    partition: row.partition,
    externalId: row.external_id,
    originalUrl: row.original_url,
    applyUrl: row.apply_url,
    identityBasis: row.identity_basis,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    status: row.status,
    missingCompleteRuns: row.missing_complete_runs,
    lastCompleteRunId: row.last_complete_run_id,
    latestSourceRecordId: row.latest_source_record_id,
    latestSourceUpdatedAt: row.latest_source_updated_at,
    latestRawHash: row.latest_raw_hash,
    attributionLabel: row.attribution_label,
    attributionUrl: row.attribution_url,
    attributionRequired: row.attribution_required === 1,
    followedLinkRequired: row.followed_link_required === 1,
  };
}

function runParameters(record: SourceRunRecord): Record<string, string | number | null> {
  return {
    id: record.id,
    sourceKey: record.sourceKey,
    partition: record.partition,
    purpose: record.purpose,
    status: record.status,
    policyVersion: record.policyVersion,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    complete: record.complete === null ? null : record.complete ? 1 : 0,
    notModified: record.notModified ? 1 : 0,
    pagesFetched: record.pagesFetched,
    recordsFetched: record.recordsFetched,
    recordsAccepted: record.recordsAccepted,
    recordsRejected: record.recordsRejected,
    recordsUnchanged: record.recordsUnchanged,
    responseEtag: record.responseEtag,
    responseLastModified: record.responseLastModified,
    responseBytes: record.responseBytes,
    errorCode: record.errorCode,
  };
}

function stateParameters(
  input: SourceStateInput,
  expectedVersion?: number,
): Record<string, string | number | null> {
  return {
    sourceKey: input.sourceKey,
    partition: input.partition,
    health: input.health,
    lastAttemptAt: input.lastAttemptAt,
    lastSuccessfulAt: input.lastSuccessfulAt,
    nextAllowedAt: input.nextAllowedAt,
    consecutiveFailures: input.consecutiveFailures,
    etag: input.etag,
    lastModified: input.lastModified,
    policyVersion: input.policyVersion,
    updatedAt: input.updatedAt,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
}

function upsertOrganization(database: SqliteDatabase, record: OrganizationRecord): void {
  database
    .prepare(
      `INSERT INTO organizations(id, name, slug, website, description, created_at, updated_at)
       VALUES (@id, @name, @slug, @website, @description, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         website = excluded.website,
         description = excluded.description,
         updated_at = excluded.updated_at`,
    )
    .run(record);
}

function upsertJob(database: SqliteDatabase, value: Job): void {
  const record = jobSchema.parse(value);
  const result = database
    .prepare(
      `INSERT INTO jobs(
         id, organization_id, organization_name, title, summary, categories_json,
         work_model, employment_type, seniority, locations_json, skills_json,
         salary_minimum, salary_maximum, salary_currency, salary_period,
         source_key, source_label, source_url, apply_mode, status, published_at, updated_at
       ) VALUES (
         @id, @organizationId, @organizationName, @title, @summary, @categoriesJson,
         @workModel, @employmentType, @seniority, @locationsJson, @skillsJson,
         @salaryMinimum, @salaryMaximum, @salaryCurrency, @salaryPeriod,
         @sourceKey, @sourceLabel, @sourceUrl, @applyMode, @status, @publishedAt, @updatedAt
       )
       ON CONFLICT(id) DO UPDATE SET
         organization_id = excluded.organization_id,
         organization_name = excluded.organization_name,
         title = excluded.title,
         summary = excluded.summary,
         categories_json = excluded.categories_json,
         work_model = excluded.work_model,
         employment_type = excluded.employment_type,
         seniority = excluded.seniority,
         locations_json = excluded.locations_json,
         skills_json = excluded.skills_json,
         salary_minimum = excluded.salary_minimum,
         salary_maximum = excluded.salary_maximum,
         salary_currency = excluded.salary_currency,
         salary_period = excluded.salary_period,
         source_key = excluded.source_key,
         source_label = excluded.source_label,
         source_url = excluded.source_url,
         apply_mode = excluded.apply_mode,
         status = excluded.status,
         published_at = excluded.published_at,
         updated_at = excluded.updated_at
       WHERE jobs.apply_mode = excluded.apply_mode`,
    )
    .run({
      id: record.id,
      organizationId: record.organizationId,
      organizationName: record.organizationName,
      title: record.title,
      summary: record.summary,
      categoriesJson: json(record.categories),
      workModel: record.workModel,
      employmentType: record.employmentType,
      seniority: record.seniority,
      locationsJson: json(record.locations),
      skillsJson: json(record.skills),
      salaryMinimum: record.salary?.minimum ?? null,
      salaryMaximum: record.salary?.maximum ?? null,
      salaryCurrency: record.salary?.currency ?? null,
      salaryPeriod: record.salary?.period ?? null,
      sourceKey: record.source.key,
      sourceLabel: record.source.label,
      sourceUrl: record.source.url,
      applyMode: record.applyMode,
      status: record.status,
      publishedAt: record.publishedAt,
      updatedAt: record.updatedAt,
    });
  if (result.changes !== 1) {
    throw new DomainError({
      code: "CONFLICT",
      message: "A job's application mode cannot change after creation.",
    });
  }
}

function assertJobApplyModeUnchanged(database: SqliteDatabase, value: Job): void {
  const existing = database.prepare("SELECT apply_mode FROM jobs WHERE id = ?").get(value.id) as
    { readonly apply_mode: Job["applyMode"] } | undefined;
  if (existing !== undefined && existing.apply_mode !== value.applyMode) {
    throw new DomainError({
      code: "CONFLICT",
      message: "A job's application mode cannot change after creation.",
    });
  }
}

function getRun(database: SqliteDatabase, id: string): SourceRunRecord | null {
  const row = database.prepare("SELECT * FROM source_runs WHERE id = ?").get(id) as
    SourceRunRow | undefined;
  return row === undefined ? null : sourceRunFromRow(row);
}

function getState(
  database: SqliteDatabase,
  sourceKey: string,
  partition: string,
): SourceStateRecord | null {
  const row = database
    .prepare("SELECT * FROM source_states WHERE source_key = ? AND partition = ?")
    .get(sourceKey, partition) as SourceStateRow | undefined;
  return row === undefined ? null : sourceStateFromRow(row);
}

function evidenceFromRow(row: EvidenceRow): StoredSourceEvidence {
  const normalization =
    row.normalization_status === null ||
    row.issues_json === null ||
    row.normalizer_version === null ||
    row.normalization_recorded_at === null
      ? null
      : {
          status: row.normalization_status,
          reason: row.normalization_reason,
          issues: parseJson(row.issues_json) as readonly string[],
          normalizerVersion: row.normalizer_version,
          normalizedHash: row.normalized_hash,
          recordedAt: row.normalization_recorded_at,
        };
  return {
    id: row.id,
    sourceKey: row.source_key,
    partition: row.partition,
    externalId: row.external_id,
    originalUrl: row.original_url,
    applyUrl: row.apply_url,
    sourceUpdatedAt: row.source_updated_at,
    fetchedAt: row.first_fetched_at,
    firstFetchedAt: row.first_fetched_at,
    retainedUntil: row.retained_until ?? row.first_fetched_at,
    rawHash: row.raw_hash,
    payload: row.payload_json === null ? null : parseJson(row.payload_json),
    policyVersion: row.policy_version,
    attribution: {
      label: row.attribution_label,
      url: row.attribution_url,
      required: row.attribution_required === 1,
      followedLinkRequired: row.followed_link_required === 1,
    },
    normalization,
  };
}

function findNormalization(
  database: SqliteDatabase,
  sourceRecordId: string,
  normalizerVersion: number,
): NormalizationRow | undefined {
  return database
    .prepare(
      `SELECT id, status, reason, issues_json, normalized_hash
       FROM normalization_results
       WHERE source_record_id = ? AND normalizer_version = ?`,
    )
    .get(sourceRecordId, normalizerVersion) as NormalizationRow | undefined;
}

function assertExistingNormalization(
  row: NormalizationRow,
  status: SourceNormalizationSummary["status"],
  reason: string | null,
  issues: readonly string[],
  normalizedHash: string | null,
): void {
  if (
    row.status !== status ||
    row.reason !== reason ||
    row.issues_json !== json(issues) ||
    row.normalized_hash !== normalizedHash
  ) {
    throw new DomainError({
      code: "CONFLICT",
      message: "A source record produced a different result for the same normalizer version.",
    });
  }
}

function persistObservation(
  database: SqliteDatabase,
  input: PersistSourceObservationInput,
): PersistSourceObservationResult {
  const persist = database.transaction(() => {
    const currentRun = getRun(database, input.runId);
    if (currentRun === null) {
      throw new DomainError({ code: "NOT_FOUND", message: "Source run was not found." });
    }
    if (currentRun.status !== "running") {
      throw new DomainError({ code: "CONFLICT", message: "Source run is already finished." });
    }
    if (
      currentRun.sourceKey !== input.evidence.sourceKey ||
      currentRun.partition !== input.evidence.partition
    ) {
      throw new DomainError({
        code: "VALIDATION",
        message: "Source evidence does not belong to the active source run.",
      });
    }
    if (input.normalization.accepted) {
      assertJobApplyModeUnchanged(database, input.normalization.job);
    }

    const existingRecord = database
      .prepare(
        `SELECT id FROM source_records
         WHERE source_key = ? AND partition = ? AND external_id = ? AND raw_hash = ?`,
      )
      .get(
        input.evidence.sourceKey,
        input.evidence.partition,
        input.evidence.externalId,
        input.evidence.rawHash,
      ) as { readonly id: string } | undefined;
    const sourceRecordId =
      existingRecord?.id ??
      stableId(
        "record",
        `${input.evidence.sourceKey}:${input.evidence.partition}:${input.evidence.externalId}:${input.evidence.rawHash}`,
      );
    const sourceRecordInserted = existingRecord === undefined;
    if (sourceRecordInserted) {
      database
        .prepare(
          `INSERT INTO source_records(
             id, source_key, partition, external_id, original_url, apply_url,
             source_updated_at, first_fetched_at, raw_hash, policy_version,
             attribution_label, attribution_url, attribution_required, followed_link_required
           ) VALUES (
             @id, @sourceKey, @partition, @externalId, @originalUrl, @applyUrl,
             @sourceUpdatedAt, @fetchedAt, @rawHash, @policyVersion,
             @attributionLabel, @attributionUrl, @attributionRequired, @followedLinkRequired
           )`,
        )
        .run({
          id: sourceRecordId,
          ...input.evidence,
          attributionLabel: input.evidence.attribution.label,
          attributionUrl: input.evidence.attribution.url,
          attributionRequired: input.evidence.attribution.required ? 1 : 0,
          followedLinkRequired: input.evidence.attribution.followedLinkRequired ? 1 : 0,
        });
      database
        .prepare(
          `INSERT INTO source_payloads(source_record_id, payload_json, retained_until)
           VALUES (?, ?, ?)`,
        )
        .run(sourceRecordId, json(input.evidence.payload), input.evidence.retainedUntil);
    }

    const status = input.normalization.accepted ? "accepted" : input.normalization.status;
    const reason = input.normalization.accepted ? null : input.normalization.reason;
    const issues = input.normalization.accepted ? [] : input.normalization.issues;
    const normalizedHash = input.normalization.accepted
      ? hash(stableJson(jobSchema.parse(input.normalization.job)))
      : null;
    let normalization = findNormalization(
      database,
      sourceRecordId,
      input.normalization.normalizerVersion,
    );
    const normalizationInserted = normalization === undefined;
    if (normalization === undefined) {
      const normalizationId = stableId(
        "normalization",
        `${sourceRecordId}:${String(input.normalization.normalizerVersion)}`,
      );
      database
        .prepare(
          `INSERT INTO normalization_results(
             id, source_record_id, normalizer_version, status, reason,
             issues_json, normalized_hash, recorded_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          normalizationId,
          sourceRecordId,
          input.normalization.normalizerVersion,
          status,
          reason,
          json(issues),
          normalizedHash,
          input.normalization.recordedAt,
        );
      normalization = {
        id: normalizationId,
        status,
        reason,
        issues_json: json(issues),
        normalized_hash: normalizedHash,
      };
    } else {
      assertExistingNormalization(normalization, status, reason, issues, normalizedHash);
    }

    database
      .prepare(
        `INSERT OR IGNORE INTO source_run_records(
           run_id, source_record_id, normalization_result_id, observed_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(input.runId, sourceRecordId, normalization.id, input.evidence.fetchedAt);

    let jobVersionInserted = false;
    if (input.normalization.accepted && normalizedHash !== null) {
      const existingLink = database
        .prepare(
          `SELECT * FROM job_source_links
           WHERE source_key = ? AND partition = ? AND external_id = ?`,
        )
        .get(input.evidence.sourceKey, input.evidence.partition, input.evidence.externalId) as
        JobSourceLinkRow | undefined;
      if (existingLink !== undefined && existingLink.job_id !== input.normalization.job.id) {
        throw new DomainError({
          code: "CONFLICT",
          message: "A source identity cannot be rebound to a different canonical job.",
        });
      }
      const sourceUpdatedAt = input.evidence.sourceUpdatedAt ?? input.normalization.job.updatedAt;
      const projectionIsNewer =
        existingLink === undefined ||
        sourceUpdatedAt > existingLink.latest_source_updated_at ||
        (sourceUpdatedAt === existingLink.latest_source_updated_at &&
          input.evidence.rawHash > existingLink.latest_raw_hash);
      if (projectionIsNewer) {
        upsertOrganization(database, input.normalization.organization);
        upsertJob(database, input.normalization.job);
      } else {
        database
          .prepare("UPDATE jobs SET status = 'open' WHERE id = ?")
          .run(input.normalization.job.id);
      }
      const result = database
        .prepare(
          `INSERT OR IGNORE INTO job_versions(
             id, job_id, source_record_id, normalization_result_id,
             normalized_hash, job_json, observed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          stableId("job_version", `${input.normalization.job.id}:${normalizedHash}`),
          input.normalization.job.id,
          sourceRecordId,
          normalization.id,
          normalizedHash,
          stableJson(input.normalization.job),
          input.normalization.recordedAt,
        );
      jobVersionInserted = result.changes === 1;
      const latestSourceRecordId = projectionIsNewer
        ? sourceRecordId
        : (existingLink?.latest_source_record_id ?? sourceRecordId);
      const latestSourceUpdatedAt = projectionIsNewer
        ? sourceUpdatedAt
        : (existingLink?.latest_source_updated_at ?? sourceUpdatedAt);
      const latestRawHash = projectionIsNewer
        ? input.evidence.rawHash
        : (existingLink?.latest_raw_hash ?? input.evidence.rawHash);
      const originalUrl = projectionIsNewer
        ? input.normalization.sourceLink.originalUrl
        : (existingLink?.original_url ?? input.normalization.sourceLink.originalUrl);
      const applyUrl = projectionIsNewer
        ? input.normalization.sourceLink.applyUrl
        : (existingLink?.apply_url ?? input.normalization.sourceLink.applyUrl);
      const lastSeenAt =
        existingLink === undefined || input.evidence.fetchedAt > existingLink.last_seen_at
          ? input.evidence.fetchedAt
          : existingLink.last_seen_at;
      database
        .prepare(
          `INSERT INTO job_source_links(
             job_id, source_key, partition, external_id, original_url, apply_url,
             identity_basis, first_seen_at, last_seen_at, status, missing_complete_runs,
             last_complete_run_id, latest_source_record_id, attribution_label,
             attribution_url, attribution_required, followed_link_required,
             latest_source_updated_at, latest_raw_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, NULL, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_key, partition, external_id) DO UPDATE SET
             job_id = excluded.job_id,
             original_url = excluded.original_url,
             apply_url = excluded.apply_url,
             identity_basis = excluded.identity_basis,
             last_seen_at = excluded.last_seen_at,
             status = 'active',
             missing_complete_runs = 0,
             last_complete_run_id = NULL,
             latest_source_record_id = excluded.latest_source_record_id,
             latest_source_updated_at = excluded.latest_source_updated_at,
             latest_raw_hash = excluded.latest_raw_hash,
             attribution_label = excluded.attribution_label,
             attribution_url = excluded.attribution_url,
             attribution_required = excluded.attribution_required,
             followed_link_required = excluded.followed_link_required`,
        )
        .run(
          input.normalization.job.id,
          input.evidence.sourceKey,
          input.evidence.partition,
          input.evidence.externalId,
          originalUrl,
          applyUrl,
          input.normalization.sourceLink.identityBasis,
          input.evidence.fetchedAt,
          lastSeenAt,
          latestSourceRecordId,
          input.evidence.attribution.label,
          input.evidence.attribution.url,
          input.evidence.attribution.required ? 1 : 0,
          input.evidence.attribution.followedLinkRequired ? 1 : 0,
          latestSourceUpdatedAt,
          latestRawHash,
        );
    }

    return {
      sourceRecordId,
      sourceRecordInserted,
      normalizationInserted,
      jobVersionInserted,
    };
  });
  return persist.immediate();
}

export function createSqliteIngestionRepository(database: SqliteDatabase): IngestionRepository {
  return {
    async insertRun(record) {
      if (record.status !== "running") {
        throw new DomainError({ code: "VALIDATION", message: "A new source run must be running." });
      }
      database
        .prepare(
          `INSERT INTO source_runs(
             id, source_key, partition, purpose, status, policy_version, started_at,
             completed_at, complete, not_modified, pages_fetched, records_fetched, records_accepted,
             records_rejected, records_unchanged, response_etag, response_last_modified,
             response_bytes, error_code
           ) VALUES (
             @id, @sourceKey, @partition, @purpose, @status, @policyVersion, @startedAt,
             @completedAt, @complete, @notModified, @pagesFetched, @recordsFetched, @recordsAccepted,
             @recordsRejected, @recordsUnchanged, @responseEtag, @responseLastModified,
             @responseBytes, @errorCode
           )`,
        )
        .run(runParameters(record));
      return record;
    },
    async finishRun(record) {
      if (record.status === "running" || record.completedAt === null || record.complete === null) {
        throw new DomainError({
          code: "VALIDATION",
          message: "A finished source run requires a terminal status and completion metadata.",
        });
      }
      const result = database
        .prepare(
          `UPDATE source_runs SET
             status = @status,
             completed_at = @completedAt,
             complete = @complete,
             not_modified = @notModified,
             pages_fetched = @pagesFetched,
             records_fetched = @recordsFetched,
             records_accepted = @recordsAccepted,
             records_rejected = @recordsRejected,
             records_unchanged = @recordsUnchanged,
             response_etag = @responseEtag,
             response_last_modified = @responseLastModified,
             response_bytes = @responseBytes,
             error_code = @errorCode
           WHERE id = @id AND status = 'running'
             AND source_key = @sourceKey AND partition = @partition`,
        )
        .run(runParameters(record));
      if (result.changes === 0) {
        const existing = getRun(database, record.id);
        throw new DomainError({
          code: existing === null ? "NOT_FOUND" : "CONFLICT",
          message:
            existing === null ? "Source run was not found." : "Source run is already finished.",
        });
      }
      const finished = getRun(database, record.id);
      if (finished === null) throw new Error("Finished source run could not be read.");
      return finished;
    },
    async getRunById(id) {
      return getRun(database, id);
    },
    async putSourceState(input, expectedVersion) {
      if (expectedVersion === null) {
        try {
          database
            .prepare(
              `INSERT INTO source_states(
                 source_key, partition, health, last_attempt_at, last_successful_at,
                 next_allowed_at, consecutive_failures, etag, last_modified,
                 policy_version, version, updated_at
               ) VALUES (
                 @sourceKey, @partition, @health, @lastAttemptAt, @lastSuccessfulAt,
                 @nextAllowedAt, @consecutiveFailures, @etag, @lastModified,
                 @policyVersion, 1, @updatedAt
               )`,
            )
            .run(stateParameters(input));
        } catch (error) {
          if (getState(database, input.sourceKey, input.partition) !== null) {
            throw new DomainError({
              code: "CONFLICT",
              message: "Source state already exists.",
              cause: error,
            });
          }
          throw error;
        }
      } else {
        const result = database
          .prepare(
            `UPDATE source_states SET
               health = @health,
               last_attempt_at = @lastAttemptAt,
               last_successful_at = @lastSuccessfulAt,
               next_allowed_at = @nextAllowedAt,
               consecutive_failures = @consecutiveFailures,
               etag = @etag,
               last_modified = @lastModified,
               policy_version = @policyVersion,
               version = version + 1,
               updated_at = @updatedAt
             WHERE source_key = @sourceKey AND partition = @partition
               AND version = @expectedVersion`,
          )
          .run(stateParameters(input, expectedVersion));
        if (result.changes === 0) {
          const existing = getState(database, input.sourceKey, input.partition);
          throw new DomainError({
            code: existing === null ? "NOT_FOUND" : "CONFLICT",
            message:
              existing === null
                ? "Source state was not found."
                : "Source state changed after it was read.",
          });
        }
      }
      const state = getState(database, input.sourceKey, input.partition);
      if (state === null) throw new Error("Persisted source state could not be read.");
      return state;
    },
    async getSourceState(sourceKey, partition) {
      return getState(database, sourceKey, partition);
    },
    async listSourceStates() {
      const rows = database
        .prepare("SELECT * FROM source_states ORDER BY source_key, partition")
        .all() as SourceStateRow[];
      return rows.map(sourceStateFromRow);
    },
    async persistObservation(input) {
      return persistObservation(database, input);
    },
    async getEvidence(id) {
      const row = database
        .prepare(
          `SELECT
             sr.*,
             sp.payload_json,
             sp.retained_until,
             nr.status AS normalization_status,
             nr.reason AS normalization_reason,
             nr.issues_json,
             nr.normalizer_version,
             nr.normalized_hash,
             nr.recorded_at AS normalization_recorded_at
           FROM source_records sr
           LEFT JOIN source_payloads sp ON sp.source_record_id = sr.id
           LEFT JOIN normalization_results nr ON nr.id = (
             SELECT candidate.id FROM normalization_results candidate
             WHERE candidate.source_record_id = sr.id
             ORDER BY candidate.normalizer_version DESC
             LIMIT 1
           )
           WHERE sr.id = ?`,
        )
        .get(id) as EvidenceRow | undefined;
      return row === undefined ? null : evidenceFromRow(row);
    },
    async listJobVersions(jobId) {
      const rows = database
        .prepare(
          `SELECT id, job_id, source_record_id, normalized_hash, job_json, observed_at
           FROM job_versions
           WHERE job_id = ?
           ORDER BY observed_at, id`,
        )
        .all(jobId) as JobVersionRow[];
      return rows.map((row): JobVersionRecord => ({
        id: row.id,
        jobId: row.job_id,
        sourceRecordId: row.source_record_id,
        normalizedHash: row.normalized_hash,
        job: jobSchema.parse(parseJson(row.job_json)),
        observedAt: row.observed_at,
      }));
    },
    async listJobSourceLinks(jobId) {
      const rows = database
        .prepare(
          `SELECT * FROM job_source_links
           WHERE job_id = ?
           ORDER BY source_key, partition, external_id`,
        )
        .all(jobId) as JobSourceLinkRow[];
      return rows.map(sourceLinkFromRow);
    },
    async reconcileCompletedRun(runId, closeAfterMisses) {
      if (!Number.isSafeInteger(closeAfterMisses) || closeAfterMisses < 1) {
        throw new DomainError({
          code: "VALIDATION",
          message: "Source closure grace must be a positive number of complete runs.",
        });
      }
      const reconcile = database.transaction(() => {
        const run = getRun(database, runId);
        if (run === null) {
          throw new DomainError({ code: "NOT_FOUND", message: "Source run was not found." });
        }
        if (run.status === "running") {
          throw new DomainError({ code: "CONFLICT", message: "Source run is not finished." });
        }
        if (!run.complete || run.status !== "succeeded" || run.notModified) {
          return { possiblyClosed: 0, closed: 0 };
        }

        const missing = database
          .prepare(
            `SELECT link.*
             FROM job_source_links link
             WHERE link.source_key = ?
               AND link.partition = ?
               AND link.status <> 'closed'
               AND NOT EXISTS (
                 SELECT 1
                 FROM source_run_records observation
                 JOIN source_records record ON record.id = observation.source_record_id
                 WHERE observation.run_id = ?
                   AND record.source_key = link.source_key
                   AND record.partition = link.partition
                   AND record.external_id = link.external_id
               )
             ORDER BY link.job_id, link.external_id`,
          )
          .all(run.sourceKey, run.partition, run.id) as JobSourceLinkRow[];
        const updateLink = database.prepare(
          `UPDATE job_source_links
           SET status = ?, missing_complete_runs = ?, last_complete_run_id = ?
           WHERE source_key = ? AND partition = ? AND external_id = ?`,
        );
        const affectedJobIds = new Set<string>();
        let possiblyClosed = 0;
        let closed = 0;
        for (const link of missing) {
          const misses = link.missing_complete_runs + 1;
          const status = misses >= closeAfterMisses ? "closed" : "possibly_closed";
          updateLink.run(status, misses, run.id, link.source_key, link.partition, link.external_id);
          affectedJobIds.add(link.job_id);
          if (status === "closed") closed += 1;
          else possiblyClosed += 1;
        }

        const sourceStatuses = database.prepare(
          `SELECT status FROM job_source_links WHERE job_id = ? ORDER BY status`,
        );
        const updateJob = database.prepare("UPDATE jobs SET status = ? WHERE id = ?");
        for (const jobId of affectedJobIds) {
          const statuses = sourceStatuses.all(jobId) as {
            readonly status: JobSourceLinkRecord["status"];
          }[];
          const jobStatus = statuses.some(({ status }) => status === "active")
            ? "open"
            : statuses.some(({ status }) => status === "possibly_closed")
              ? "stale"
              : "closed";
          updateJob.run(jobStatus, jobId);
        }
        return { possiblyClosed, closed };
      });
      return reconcile.immediate();
    },
    async purgeExpiredPayloads(now, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
        throw new DomainError({
          code: "VALIDATION",
          message: "Payload retention cleanup limit must be between 1 and 10000.",
        });
      }
      const purge = database.transaction(() => {
        const expired = database
          .prepare(
            `SELECT source_record_id
             FROM source_payloads
             WHERE retained_until <= ?
             ORDER BY retained_until, source_record_id
             LIMIT ?`,
          )
          .all(now, limit) as { readonly source_record_id: string }[];
        const remove = database.prepare(
          "DELETE FROM source_payloads WHERE source_record_id = ? AND retained_until <= ?",
        );
        let removed = 0;
        for (const record of expired) {
          removed += remove.run(record.source_record_id, now).changes;
        }
        return removed;
      });
      return purge.immediate();
    },
  };
}
