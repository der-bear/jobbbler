import { createHash } from "node:crypto";

import {
  applicationDraftSchema,
  jobSchema,
  jobSearchCriteriaSchema,
  scheduleRecurrenceSchema,
  type ApplicationDraft,
  type Job,
  type JobSearchCriteria,
} from "@jobbbler/contracts";
import { DomainError } from "@jobbbler/core-domain";
import { rankJob } from "@jobbbler/jobs-domain";
import type {
  AuditEventRecord,
  ClaimWorkItemsInput,
  IdempotencyRecord,
  JobSearchPage,
  OrganizationRecord,
  OwnerRecord,
  SavedSearchRecord,
  ScheduleRecord,
  Storage,
  WorkItemRecord,
} from "@jobbbler/storage";

import { openSqliteDatabase, type SqliteDatabase } from "./connection.js";
import { toFts5Query } from "./fts.js";
import { createSqliteIngestionRepository } from "./ingestion-repository.js";
import { migrateSqlite } from "./migrate.js";

type SqlParameter = string | number | bigint | null | Uint8Array;

interface RankedJob {
  readonly job: Job;
  readonly rank: ReturnType<typeof rankJob>;
}

interface SearchCursor {
  readonly version: 1;
  readonly sort: JobSearchCriteria["sort"];
  readonly primary: number;
  readonly publishedAt: string;
  readonly id: string;
  readonly fingerprint: string;
}

interface OwnerRow {
  readonly id: string;
  readonly kind: OwnerRecord["kind"];
  readonly verified: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface OrganizationRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly website: string | null;
  readonly description: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface JobRow {
  readonly id: string;
  readonly organization_id: string;
  readonly organization_name: string;
  readonly title: string;
  readonly summary: string;
  readonly categories_json: string;
  readonly work_model: Job["workModel"];
  readonly employment_type: Job["employmentType"];
  readonly seniority: Job["seniority"];
  readonly locations_json: string;
  readonly skills_json: string;
  readonly salary_minimum: number | null;
  readonly salary_maximum: number | null;
  readonly salary_currency: string | null;
  readonly salary_period: "hour" | "month" | "year" | null;
  readonly source_key: string;
  readonly source_label: string;
  readonly source_url: string | null;
  readonly apply_mode: Job["applyMode"];
  readonly status: Job["status"];
  readonly published_at: string;
  readonly updated_at: string;
}

interface SavedSearchRow {
  readonly id: string;
  readonly owner_id: string;
  readonly name: string;
  readonly criteria_json: string;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ScheduleRow {
  readonly id: string;
  readonly owner_id: string;
  readonly saved_search_id: string;
  readonly recurrence_json: string;
  readonly delivery_channel: "email";
  readonly delivery_endpoint_id: string;
  readonly enabled: number;
  readonly next_run_at: string;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ApplicationRow {
  readonly id: string;
  readonly owner_id: string;
  readonly job_id: string;
  readonly state: ApplicationDraft["state"];
  readonly version: number;
  readonly answers_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface WorkItemRow {
  readonly id: string;
  readonly kind: string;
  readonly payload_json: string;
  readonly status: WorkItemRecord["status"];
  readonly available_at: string;
  readonly attempt: number;
  readonly max_attempts: number;
  readonly lease_owner: string | null;
  readonly lease_expires_at: string | null;
  readonly last_error_code: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AuditRow {
  readonly id: string;
  readonly type: string;
  readonly actor_kind: AuditEventRecord["actorKind"];
  readonly actor_id: string | null;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly correlation_id: string;
  readonly safe_metadata_json: string;
  readonly occurred_at: string;
}

interface IdempotencyRow {
  readonly scope: string;
  readonly key: string;
  readonly request_hash: string;
  readonly response_status: number;
  readonly response_body_json: string;
  readonly created_at: string;
  readonly expires_at: string;
}

export interface CreateSqliteStorageOptions {
  readonly migrationDirectory?: string;
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new DomainError({ code: "VALIDATION", message: "Expected a JSON-serializable value." });
  }
  return serialized;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function ownerFromRow(row: OwnerRow): OwnerRecord {
  return {
    id: row.id,
    kind: row.kind,
    verified: row.verified === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function organizationFromRow(row: OrganizationRow): OrganizationRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    website: row.website,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function jobFromRow(row: JobRow): Job {
  return jobSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    title: row.title,
    summary: row.summary,
    categories: parseJson(row.categories_json),
    workModel: row.work_model,
    employmentType: row.employment_type,
    seniority: row.seniority,
    locations: parseJson(row.locations_json),
    skills: parseJson(row.skills_json),
    salary:
      row.salary_currency === null || row.salary_period === null
        ? null
        : {
            minimum: row.salary_minimum,
            maximum: row.salary_maximum,
            currency: row.salary_currency,
            period: row.salary_period,
          },
    source: { key: row.source_key, label: row.source_label, url: row.source_url },
    applyMode: row.apply_mode,
    status: row.status,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  });
}

function savedSearchFromRow(row: SavedSearchRow): SavedSearchRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    criteria: jobSearchCriteriaSchema.parse(parseJson(row.criteria_json)),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scheduleFromRow(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    savedSearchId: row.saved_search_id,
    recurrence: scheduleRecurrenceSchema.parse(parseJson(row.recurrence_json)),
    deliveryChannel: row.delivery_channel,
    deliveryEndpointId: row.delivery_endpoint_id,
    enabled: row.enabled === 1,
    nextRunAt: row.next_run_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function applicationFromRow(row: ApplicationRow): ApplicationDraft {
  return applicationDraftSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    jobId: row.job_id,
    state: row.state,
    version: row.version,
    answers: parseJson(row.answers_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function workItemFromRow(row: WorkItemRow): WorkItemRecord {
  const payload = parseJson(row.payload_json);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new DomainError({ code: "INTERNAL", message: "Stored work-item payload is invalid." });
  }

  return {
    id: row.id,
    kind: row.kind,
    payload: payload as Readonly<Record<string, unknown>>,
    status: row.status,
    availableAt: row.available_at,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function auditFromRow(row: AuditRow): AuditEventRecord {
  const metadata = parseJson(row.safe_metadata_json);
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new DomainError({ code: "INTERNAL", message: "Stored audit metadata is invalid." });
  }

  return {
    id: row.id,
    type: row.type,
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    correlationId: row.correlation_id,
    safeMetadata: metadata as Readonly<Record<string, unknown>>,
    occurredAt: row.occurred_at,
  };
}

function idempotencyFromRow(row: IdempotencyRow): IdempotencyRecord {
  return {
    scope: row.scope,
    key: row.key,
    requestHash: row.request_hash,
    responseStatus: row.response_status,
    responseBody: parseJson(row.response_body_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function notFound(entity: string): DomainError {
  return new DomainError({ code: "NOT_FOUND", message: `${entity} was not found.` });
}

function versionConflict(entity: string): DomainError {
  return new DomainError({
    code: "CONFLICT",
    message: `${entity} changed after it was read. Refresh and retry.`,
  });
}

function criteriaFingerprint(criteria: JobSearchCriteria): string {
  const canonical = {
    query: criteria.query,
    categories: criteria.categories,
    workModels: criteria.workModels,
    seniorities: criteria.seniorities,
    locations: criteria.locations,
    skills: criteria.skills,
    excludeKeywords: criteria.excludeKeywords,
    salary: criteria.salary,
    postedWithinDays: criteria.postedWithinDays,
    sort: criteria.sort,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("base64url").slice(0, 16);
}

function primarySortValue(entry: RankedJob, sort: JobSearchCriteria["sort"]): number {
  if (sort === "relevance") return entry.rank.score;
  if (sort === "salary_desc") {
    return entry.job.salary?.maximum ?? entry.job.salary?.minimum ?? -1;
  }
  return 0;
}

function compareRankedJobs(
  left: RankedJob,
  right: RankedJob,
  sort: JobSearchCriteria["sort"],
): number {
  if (sort !== "newest") {
    const primaryDifference = primarySortValue(right, sort) - primarySortValue(left, sort);
    if (primaryDifference !== 0) return primaryDifference;
  }
  const publishedDifference = right.job.publishedAt.localeCompare(left.job.publishedAt);
  return publishedDifference === 0 ? left.job.id.localeCompare(right.job.id) : publishedDifference;
}

function encodeSearchCursor(entry: RankedJob, criteria: JobSearchCriteria): string {
  const cursor: SearchCursor = {
    version: 1,
    sort: criteria.sort,
    primary: primarySortValue(entry, criteria.sort),
    publishedAt: entry.job.publishedAt,
    id: entry.job.id,
    fingerprint: criteriaFingerprint(criteria),
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function invalidCursor(): DomainError {
  return new DomainError({
    code: "VALIDATION",
    message: "Search cursor is invalid or does not match the current search.",
  });
}

function decodeSearchCursor(value: string, criteria: JobSearchCriteria): SearchCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("sort" in parsed) ||
      parsed.sort !== criteria.sort ||
      !("primary" in parsed) ||
      typeof parsed.primary !== "number" ||
      !Number.isFinite(parsed.primary) ||
      !("publishedAt" in parsed) ||
      typeof parsed.publishedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.publishedAt)) ||
      !("id" in parsed) ||
      typeof parsed.id !== "string" ||
      !("fingerprint" in parsed) ||
      parsed.fingerprint !== criteriaFingerprint(criteria)
    ) {
      throw invalidCursor();
    }
    return parsed as SearchCursor;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw invalidCursor();
  }
}

function compareRankedJobToCursor(entry: RankedJob, cursor: SearchCursor): number {
  if (cursor.sort !== "newest") {
    const primaryDifference = cursor.primary - primarySortValue(entry, cursor.sort);
    if (primaryDifference !== 0) return primaryDifference;
  }
  const publishedDifference = cursor.publishedAt.localeCompare(entry.job.publishedAt);
  return publishedDifference === 0 ? entry.job.id.localeCompare(cursor.id) : publishedDifference;
}

function insertOwner(database: SqliteDatabase, record: OwnerRecord): OwnerRecord {
  database
    .prepare(
      `INSERT INTO owners(id, kind, verified, version, created_at, updated_at)
       VALUES (@id, @kind, @verified, @version, @createdAt, @updatedAt)`,
    )
    .run({ ...record, verified: record.verified ? 1 : 0 });
  return record;
}

function upsertOrganization(
  database: SqliteDatabase,
  record: OrganizationRecord,
): OrganizationRecord {
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
  return record;
}

function upsertJob(database: SqliteDatabase, record: Job): Job {
  database
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
         updated_at = excluded.updated_at`,
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
  return record;
}

function searchJobs(
  database: SqliteDatabase,
  criteria: JobSearchCriteria,
  now: string,
  limit: number,
): JobSearchPage {
  const joins: string[] = [];
  const where = ["j.status = 'open'"];
  const parameters: SqlParameter[] = [];
  const ftsQuery = criteria.query === null ? null : toFts5Query(criteria.query);

  if (ftsQuery !== null) {
    joins.push("JOIN jobs_fts ON jobs_fts.job_id = j.id");
    where.push("jobs_fts MATCH ?");
    parameters.push(ftsQuery);
  }

  if (criteria.categories.length > 0) {
    where.push(
      `EXISTS (
         SELECT 1 FROM json_each(j.categories_json) category
         WHERE category.value IN (${criteria.categories.map(() => "?").join(", ")})
       )`,
    );
    parameters.push(...criteria.categories);
  }

  if (criteria.workModels.length > 0) {
    where.push(`j.work_model IN (${criteria.workModels.map(() => "?").join(", ")})`);
    parameters.push(...criteria.workModels);
  }

  if (criteria.seniorities.length > 0) {
    where.push(`j.seniority IN (${criteria.seniorities.map(() => "?").join(", ")})`);
    parameters.push(...criteria.seniorities);
  }

  if (criteria.locations.length > 0) {
    const locationClauses = criteria.locations.map(
      () =>
        "lower(location.value) LIKE '%' || lower(?) || '%' OR lower(?) LIKE '%' || lower(location.value) || '%'",
    );
    where.push(
      `EXISTS (
         SELECT 1 FROM json_each(j.locations_json) location
         WHERE ${locationClauses.map((clause) => `(${clause})`).join(" OR ")}
       )`,
    );
    for (const location of criteria.locations) parameters.push(location, location);
  }

  if (criteria.postedWithinDays !== null) {
    const nowDate = new Date(now);
    const cutoff = new Date(
      nowDate.getTime() - criteria.postedWithinDays * 24 * 60 * 60 * 1_000,
    ).toISOString();
    where.push("j.published_at BETWEEN ? AND ?");
    parameters.push(cutoff, nowDate.toISOString());
  }

  const rows = database
    .prepare(
      `SELECT j.*
       FROM jobs j
       ${joins.join("\n")}
       WHERE ${where.join(" AND ")}`,
    )
    .all(...parameters) as JobRow[];

  let ranked = rows
    .map((row) => {
      const job = jobFromRow(row);
      return { job, rank: rankJob(job, criteria, { now: new Date(now) }) };
    })
    .filter(({ rank }) => rank.eligible);
  const total = ranked.length;
  const catalogUpdatedAt = ranked.reduce<string | null>(
    (latest, { job }) =>
      latest === null || Date.parse(job.updatedAt) > Date.parse(latest) ? job.updatedAt : latest,
    null,
  );

  ranked.sort((left, right) => compareRankedJobs(left, right, criteria.sort));
  if (criteria.cursor !== null) {
    const cursor = decodeSearchCursor(criteria.cursor, criteria);
    ranked = ranked.filter((entry) => compareRankedJobToCursor(entry, cursor) > 0);
  }

  const effectiveLimit = Math.min(50, Math.max(1, Math.trunc(limit)), criteria.limit);
  const hasNextPage = ranked.length > effectiveLimit;
  const page = ranked.slice(0, effectiveLimit);
  const last = page.at(-1);
  return {
    jobs: page.map(({ job }) => job),
    total,
    nextCursor: hasNextPage && last !== undefined ? encodeSearchCursor(last, criteria) : null,
    catalogUpdatedAt,
  };
}

function createRepositories(database: SqliteDatabase): Omit<Storage, "close" | "ingestion"> {
  return {
    owners: {
      async insert(record) {
        return insertOwner(database, record);
      },
      async getById(id) {
        const row = database.prepare("SELECT * FROM owners WHERE id = ?").get(id) as
          OwnerRow | undefined;
        return row === undefined ? null : ownerFromRow(row);
      },
    },
    organizations: {
      async upsert(record) {
        return upsertOrganization(database, record);
      },
      async getById(id) {
        const row = database.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as
          OrganizationRow | undefined;
        return row === undefined ? null : organizationFromRow(row);
      },
    },
    jobs: {
      async upsert(record) {
        return upsertJob(database, jobSchema.parse(record));
      },
      async getById(id) {
        const row = database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
          JobRow | undefined;
        return row === undefined ? null : jobFromRow(row);
      },
      async search(query) {
        return searchJobs(database, query.criteria, query.now, query.limit);
      },
      async listAll() {
        const rows = database.prepare("SELECT * FROM jobs ORDER BY id").all() as JobRow[];
        return rows.map(jobFromRow);
      },
    },
    savedSearches: {
      async insert(record) {
        database
          .prepare(
            `INSERT INTO saved_searches(
               id, owner_id, name, criteria_json, version, created_at, updated_at
             ) VALUES (@id, @ownerId, @name, @criteriaJson, @version, @createdAt, @updatedAt)`,
          )
          .run({ ...record, criteriaJson: json(record.criteria) });
        return record;
      },
      async getById(id) {
        const row = database.prepare("SELECT * FROM saved_searches WHERE id = ?").get(id) as
          SavedSearchRow | undefined;
        return row === undefined ? null : savedSearchFromRow(row);
      },
      async listByOwner(ownerId) {
        const rows = database
          .prepare("SELECT * FROM saved_searches WHERE owner_id = ? ORDER BY updated_at DESC, id")
          .all(ownerId) as SavedSearchRow[];
        return rows.map(savedSearchFromRow);
      },
      async update(record, expectedVersion) {
        const result = database
          .prepare(
            `UPDATE saved_searches
             SET name = @name,
                 criteria_json = @criteriaJson,
                 version = version + 1,
                 updated_at = @updatedAt
             WHERE id = @id AND version = @expectedVersion`,
          )
          .run({
            id: record.id,
            name: record.name,
            criteriaJson: json(record.criteria),
            updatedAt: record.updatedAt,
            expectedVersion,
          });
        if (result.changes === 0) {
          const exists = database
            .prepare("SELECT 1 AS present FROM saved_searches WHERE id = ?")
            .get(record.id);
          throw exists === undefined ? notFound("Saved search") : versionConflict("Saved search");
        }
        const row = database.prepare("SELECT * FROM saved_searches WHERE id = ?").get(record.id) as
          SavedSearchRow | undefined;
        if (row === undefined) throw notFound("Saved search");
        return savedSearchFromRow(row);
      },
    },
    schedules: {
      async insert(record) {
        database
          .prepare(
            `INSERT INTO schedules(
               id, owner_id, saved_search_id, recurrence_json, delivery_channel,
               delivery_endpoint_id, enabled, next_run_at, version, created_at, updated_at
             ) VALUES (
               @id, @ownerId, @savedSearchId, @recurrenceJson, @deliveryChannel,
               @deliveryEndpointId, @enabled, @nextRunAt, @version, @createdAt, @updatedAt
             )`,
          )
          .run({
            ...record,
            recurrenceJson: json(record.recurrence),
            enabled: record.enabled ? 1 : 0,
          });
        return record;
      },
      async getById(id) {
        const row = database.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as
          ScheduleRow | undefined;
        return row === undefined ? null : scheduleFromRow(row);
      },
      async listDue(now, limit) {
        const rows = database
          .prepare(
            `SELECT * FROM schedules
             WHERE enabled = 1 AND next_run_at <= ?
             ORDER BY next_run_at, id
             LIMIT ?`,
          )
          .all(now, limit) as ScheduleRow[];
        return rows.map(scheduleFromRow);
      },
      async update(record, expectedVersion) {
        const result = database
          .prepare(
            `UPDATE schedules
             SET recurrence_json = @recurrenceJson,
                 delivery_channel = @deliveryChannel,
                 delivery_endpoint_id = @deliveryEndpointId,
                 enabled = @enabled,
                 next_run_at = @nextRunAt,
                 version = version + 1,
                 updated_at = @updatedAt
             WHERE id = @id AND version = @expectedVersion`,
          )
          .run({
            id: record.id,
            recurrenceJson: json(record.recurrence),
            deliveryChannel: record.deliveryChannel,
            deliveryEndpointId: record.deliveryEndpointId,
            enabled: record.enabled ? 1 : 0,
            nextRunAt: record.nextRunAt,
            updatedAt: record.updatedAt,
            expectedVersion,
          });
        if (result.changes === 0) {
          const exists = database.prepare("SELECT 1 FROM schedules WHERE id = ?").get(record.id);
          throw exists === undefined ? notFound("Schedule") : versionConflict("Schedule");
        }
        const row = database.prepare("SELECT * FROM schedules WHERE id = ?").get(record.id) as
          ScheduleRow | undefined;
        if (row === undefined) throw notFound("Schedule");
        return scheduleFromRow(row);
      },
    },
    applications: {
      async insert(record) {
        const parsed = applicationDraftSchema.parse(record);
        database
          .prepare(
            `INSERT INTO application_drafts(
               id, owner_id, job_id, state, version, answers_json, created_at, updated_at
             ) VALUES (@id, @ownerId, @jobId, @state, @version, @answersJson, @createdAt, @updatedAt)`,
          )
          .run({ ...parsed, answersJson: json(parsed.answers) });
        return parsed;
      },
      async getById(id) {
        const row = database.prepare("SELECT * FROM application_drafts WHERE id = ?").get(id) as
          ApplicationRow | undefined;
        return row === undefined ? null : applicationFromRow(row);
      },
      async update(record, expectedVersion) {
        const parsed = applicationDraftSchema.parse(record);
        const result = database
          .prepare(
            `UPDATE application_drafts
             SET state = @state,
                 answers_json = @answersJson,
                 version = version + 1,
                 updated_at = @updatedAt
             WHERE id = @id AND version = @expectedVersion`,
          )
          .run({
            id: parsed.id,
            state: parsed.state,
            answersJson: json(parsed.answers),
            updatedAt: parsed.updatedAt,
            expectedVersion,
          });
        if (result.changes === 0) {
          const exists = database
            .prepare("SELECT 1 FROM application_drafts WHERE id = ?")
            .get(parsed.id);
          throw exists === undefined
            ? notFound("Application draft")
            : versionConflict("Application draft");
        }
        const row = database
          .prepare("SELECT * FROM application_drafts WHERE id = ?")
          .get(parsed.id) as ApplicationRow | undefined;
        if (row === undefined) throw notFound("Application draft");
        return applicationFromRow(row);
      },
    },
    workItems: {
      async insert(record) {
        database
          .prepare(
            `INSERT INTO work_items(
               id, kind, payload_json, status, available_at, attempt, max_attempts,
               lease_owner, lease_expires_at, last_error_code, created_at, updated_at
             ) VALUES (
               @id, @kind, @payloadJson, @status, @availableAt, @attempt, @maxAttempts,
               @leaseOwner, @leaseExpiresAt, @lastErrorCode, @createdAt, @updatedAt
             )`,
          )
          .run({ ...record, payloadJson: json(record.payload) });
        return record;
      },
      async putIfAbsent(record) {
        const put = database.transaction(() => {
          const existing = database
            .prepare("SELECT * FROM work_items WHERE id = ?")
            .get(record.id) as WorkItemRow | undefined;
          if (existing !== undefined) {
            const stored = workItemFromRow(existing);
            if (
              stored.kind !== record.kind ||
              json(stored.payload) !== json(record.payload) ||
              stored.maxAttempts !== record.maxAttempts
            ) {
              throw new DomainError({
                code: "CONFLICT",
                message: "Work-item ID is already bound to a different task.",
              });
            }
            return { inserted: false, record: stored };
          }
          database
            .prepare(
              `INSERT INTO work_items(
                 id, kind, payload_json, status, available_at, attempt, max_attempts,
                 lease_owner, lease_expires_at, last_error_code, created_at, updated_at
               ) VALUES (
                 @id, @kind, @payloadJson, @status, @availableAt, @attempt, @maxAttempts,
                 @leaseOwner, @leaseExpiresAt, @lastErrorCode, @createdAt, @updatedAt
               )`,
            )
            .run({ ...record, payloadJson: json(record.payload) });
          return { inserted: true, record };
        });
        return put.immediate();
      },
      async getById(id) {
        const row = database.prepare("SELECT * FROM work_items WHERE id = ?").get(id) as
          WorkItemRow | undefined;
        return row === undefined ? null : workItemFromRow(row);
      },
      async claimDue(input: ClaimWorkItemsInput) {
        const claim = database.transaction(() => {
          const candidates = database
            .prepare(
              `SELECT id FROM work_items
               WHERE attempt < max_attempts
                 AND (
                   (status IN ('pending', 'failed') AND available_at <= @now)
                   OR (status = 'running' AND lease_expires_at <= @now)
                 )
               ORDER BY available_at, created_at, id
               LIMIT @limit`,
            )
            .all(input) as { readonly id: string }[];

          if (candidates.length === 0) return [];
          const update = database.prepare(
            `UPDATE work_items
             SET status = 'running',
                 attempt = attempt + 1,
                 lease_owner = ?,
                 lease_expires_at = ?,
                 updated_at = ?
             WHERE id = ?`,
          );
          for (const candidate of candidates) {
            update.run(input.workerId, input.leaseExpiresAt, input.now, candidate.id);
          }
          const placeholders = candidates.map(() => "?").join(", ");
          return database
            .prepare(
              `SELECT * FROM work_items WHERE id IN (${placeholders}) ORDER BY available_at, created_at, id`,
            )
            .all(...candidates.map(({ id }) => id)) as WorkItemRow[];
        });

        return claim.immediate().map(workItemFromRow);
      },
      async renewLease(input) {
        const result = database
          .prepare(
            `UPDATE work_items
             SET lease_expires_at = @leaseExpiresAt,
                 updated_at = @now
             WHERE id = @id
               AND status = 'running'
               AND lease_owner = @workerId
               AND lease_expires_at > @now
               AND lease_expires_at < @leaseExpiresAt`,
          )
          .run(input);
        if (result.changes === 0) {
          const exists = database.prepare("SELECT 1 FROM work_items WHERE id = ?").get(input.id);
          throw exists === undefined
            ? notFound("Work item")
            : new DomainError({
                code: "CONFLICT",
                message: "Work item is not held by this worker under an active lease.",
              });
        }
        const row = database.prepare("SELECT * FROM work_items WHERE id = ?").get(input.id) as
          WorkItemRow | undefined;
        if (row === undefined) throw notFound("Work item");
        return workItemFromRow(row);
      },
      async complete(id, workerId, now) {
        const result = database
          .prepare(
            `UPDATE work_items
             SET status = 'succeeded',
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 last_error_code = NULL,
                 updated_at = ?
             WHERE id = ?
               AND status = 'running'
               AND lease_owner = ?
               AND lease_expires_at > ?`,
          )
          .run(now, id, workerId, now);
        if (result.changes === 0) {
          const exists = database.prepare("SELECT 1 FROM work_items WHERE id = ?").get(id);
          throw exists === undefined
            ? notFound("Work item")
            : new DomainError({
                code: "CONFLICT",
                message: "Work item is not held by this worker under an active lease.",
              });
        }
        const row = database.prepare("SELECT * FROM work_items WHERE id = ?").get(id) as
          WorkItemRow | undefined;
        if (row === undefined) throw notFound("Work item");
        return workItemFromRow(row);
      },
      async fail(input) {
        const result = database
          .prepare(
            `UPDATE work_items
             SET status = CASE
                   WHEN @terminal = 1 OR attempt >= max_attempts THEN 'dead'
                   ELSE 'failed'
                 END,
                 available_at = CASE
                   WHEN @terminal = 1 OR attempt >= max_attempts THEN @now
                   ELSE @retryAt
                 END,
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 last_error_code = @errorCode,
                 updated_at = @now
             WHERE id = @id
               AND status = 'running'
               AND lease_owner = @workerId
               AND lease_expires_at > @now`,
          )
          .run({ ...input, terminal: input.terminal ? 1 : 0 });
        if (result.changes === 0) {
          const exists = database.prepare("SELECT 1 FROM work_items WHERE id = ?").get(input.id);
          throw exists === undefined
            ? notFound("Work item")
            : new DomainError({
                code: "CONFLICT",
                message: "Work item is not held by this worker under an active lease.",
              });
        }
        const row = database.prepare("SELECT * FROM work_items WHERE id = ?").get(input.id) as
          WorkItemRow | undefined;
        if (row === undefined) throw notFound("Work item");
        return workItemFromRow(row);
      },
    },
    audit: {
      async append(record) {
        database
          .prepare(
            `INSERT INTO audit_events(
               id, type, actor_kind, actor_id, aggregate_type, aggregate_id,
               correlation_id, safe_metadata_json, occurred_at
             ) VALUES (
               @id, @type, @actorKind, @actorId, @aggregateType, @aggregateId,
               @correlationId, @safeMetadataJson, @occurredAt
             )`,
          )
          .run({ ...record, safeMetadataJson: json(record.safeMetadata) });
        return record;
      },
      async listForAggregate(aggregateType, aggregateId, limit) {
        const rows = database
          .prepare(
            `SELECT id, type, actor_kind, actor_id, aggregate_type, aggregate_id,
                    correlation_id, safe_metadata_json, occurred_at
             FROM audit_events
             WHERE aggregate_type = ? AND aggregate_id = ?
             ORDER BY occurred_at, sequence
             LIMIT ?`,
          )
          .all(aggregateType, aggregateId, limit) as AuditRow[];
        return rows.map(auditFromRow);
      },
    },
    idempotency: {
      async putIfAbsent(record) {
        const put = database.transaction(() => {
          const existing = database
            .prepare("SELECT * FROM idempotency_records WHERE scope = ? AND key = ?")
            .get(record.scope, record.key) as IdempotencyRow | undefined;
          if (existing !== undefined) {
            if (existing.request_hash !== record.requestHash) {
              throw new DomainError({
                code: "CONFLICT",
                message: "The idempotency key is already bound to a different request.",
              });
            }
            return { inserted: false, record: idempotencyFromRow(existing) };
          }

          database
            .prepare(
              `INSERT INTO idempotency_records(
                 scope, key, request_hash, response_status, response_body_json, created_at, expires_at
               ) VALUES (
                 @scope, @key, @requestHash, @responseStatus, @responseBodyJson, @createdAt, @expiresAt
               )`,
            )
            .run({ ...record, responseBodyJson: json(record.responseBody) });
          return { inserted: true, record };
        });
        return put.immediate();
      },
      async get(scope, key) {
        const row = database
          .prepare("SELECT * FROM idempotency_records WHERE scope = ? AND key = ?")
          .get(scope, key) as IdempotencyRow | undefined;
        return row === undefined ? null : idempotencyFromRow(row);
      },
    },
  };
}

export function createSqliteStorage(
  filename: string,
  options: CreateSqliteStorageOptions = {},
): Storage {
  const database = openSqliteDatabase(filename);

  try {
    migrateSqlite(database, {
      ...(options.migrationDirectory === undefined
        ? {}
        : { directory: options.migrationDirectory }),
    });
    const repositories = createRepositories(database);
    return {
      ...repositories,
      ingestion: createSqliteIngestionRepository(database),
      close() {
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
