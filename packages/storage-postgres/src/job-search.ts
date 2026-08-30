import { createHash } from "node:crypto";

import { DomainError } from "@jobbbler/core-domain";
import { parseJob } from "@jobbbler/jobs-domain";
import type { Job, JobSearchPage, JobSearchQuery } from "@jobbbler/storage";

import type { PostgresSql } from "./connection.js";

type JobSearchCriteria = JobSearchQuery["criteria"];

interface SearchCursor {
  readonly v: 1;
  readonly s: JobSearchCriteria["sort"];
  readonly p: number;
  readonly t: string;
  readonly i: string;
  readonly f: string;
}

interface SearchPageEntry {
  readonly body: unknown;
  readonly primary: number | string;
  readonly published_at: string;
  readonly job_id: string;
}

interface SearchRow {
  readonly total: string;
  readonly catalog_updated_at: string | null;
  readonly page: readonly SearchPageEntry[];
}

interface ParsedPageEntry {
  readonly job: Job;
  readonly primary: number;
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

function invalidCursor(): DomainError {
  return new DomainError({
    code: "VALIDATION",
    message: "Search cursor is invalid or does not match the current search.",
  });
}

function decodeCursor(value: string, criteria: JobSearchCriteria): SearchCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("v" in parsed) ||
      parsed.v !== 1 ||
      !("s" in parsed) ||
      parsed.s !== criteria.sort ||
      !("p" in parsed) ||
      typeof parsed.p !== "number" ||
      !Number.isFinite(parsed.p) ||
      !("t" in parsed) ||
      typeof parsed.t !== "string" ||
      Number.isNaN(Date.parse(parsed.t)) ||
      !("i" in parsed) ||
      typeof parsed.i !== "string" ||
      !("f" in parsed) ||
      parsed.f !== criteriaFingerprint(criteria)
    ) {
      throw invalidCursor();
    }
    return parsed as SearchCursor;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw invalidCursor();
  }
}

function encodeCursor(entry: ParsedPageEntry, criteria: JobSearchCriteria): string {
  const cursor: SearchCursor = {
    v: 1,
    s: criteria.sort,
    p: entry.primary,
    t: entry.job.publishedAt,
    i: entry.job.id,
    f: criteriaFingerprint(criteria),
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function parsePageEntry(entry: SearchPageEntry): ParsedPageEntry {
  const primary = Number(entry.primary);
  if (!Number.isFinite(primary)) throw new TypeError("PostgreSQL search returned an invalid rank.");
  const job = parseJob(entry.body);
  if (entry.job_id !== job.id || Number.isNaN(Date.parse(entry.published_at))) {
    throw new TypeError("PostgreSQL search returned an invalid projection row.");
  }
  return { job, primary };
}

export async function searchPostgresJobs(
  sql: PostgresSql,
  query: JobSearchQuery,
): Promise<JobSearchPage> {
  const effectiveLimit = Math.min(50, Math.max(1, Math.trunc(query.limit)), query.criteria.limit);
  const cursor =
    query.criteria.cursor === null ? null : decodeCursor(query.criteria.cursor, query.criteria);
  const rows = await sql<SearchRow[]>`
    WITH input AS (
      SELECT
        ${sql.json(query.criteria)}::jsonb AS criteria,
        ${query.now}::timestamptz AS now_at,
        ${effectiveLimit + 1}::integer AS page_limit,
        ${cursor?.p ?? null}::double precision AS cursor_primary,
        ${cursor?.t ?? null}::timestamptz AS cursor_published_at,
        ${cursor?.i ?? null}::text AS cursor_id
    ),
    candidates AS (
      SELECT search.*, input.criteria, input.now_at
      FROM jobbbler.job_search_documents AS search
      CROSS JOIN input
      WHERE search.status = 'open'
        AND (
          input.criteria->>'query' IS NULL
          OR search.document @@ plainto_tsquery('simple', input.criteria->>'query')
        )
        AND (
          jsonb_array_length(input.criteria->'categories') = 0
          OR search.categories && ARRAY(
            SELECT value FROM jsonb_array_elements_text(input.criteria->'categories') AS requested(value)
          )
        )
        AND (
          jsonb_array_length(input.criteria->'workModels') = 0
          OR search.work_model IN (
            SELECT value FROM jsonb_array_elements_text(input.criteria->'workModels') AS requested(value)
          )
        )
        AND (
          jsonb_array_length(input.criteria->'seniorities') = 0
          OR search.seniority IN (
            SELECT value FROM jsonb_array_elements_text(input.criteria->'seniorities') AS requested(value)
          )
        )
        AND (
          jsonb_array_length(input.criteria->'locations') = 0
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(input.criteria->'locations') AS requested(value)
            CROSS JOIN LATERAL (
              SELECT jobbbler.normalize_search_text(requested.value) AS term
            ) AS normalized
            WHERE normalized.term <> ''
              AND EXISTS (
                SELECT 1
                FROM unnest(search.location_terms) AS actual(term)
                WHERE actual.term <> ''
                  AND (
                    strpos(actual.term, normalized.term) > 0
                    OR strpos(normalized.term, actual.term) > 0
                  )
              )
          )
        )
        AND (
          input.criteria->>'postedWithinDays' IS NULL
          OR search.published_at BETWEEN
            input.now_at - (input.criteria->>'postedWithinDays')::integer * interval '1 day'
            AND input.now_at
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(input.criteria->'excludeKeywords') AS requested(value)
          CROSS JOIN LATERAL (
            SELECT jobbbler.normalize_search_text(requested.value) AS term
          ) AS normalized
          WHERE normalized.term <> '' AND strpos(search.normalized_text, normalized.term) > 0
        )
    ),
    salary_amounts AS (
      SELECT
        candidates.*,
        NULLIF(candidates.criteria->'salary', 'null'::jsonb) AS requested_salary,
        NULLIF(candidates.body->'salary', 'null'::jsonb) AS job_salary
      FROM candidates
    ),
    converted_salary AS (
      SELECT
        salary_amounts.*,
        CASE
          WHEN job_salary->>'currency' = requested_salary->>'currency'
            THEN (job_salary->>'minimum')::numeric
          WHEN job_salary->>'currency' IN ('EUR', 'USD', 'GBP', 'CAD')
            AND requested_salary->>'currency' IN ('EUR', 'USD', 'GBP', 'CAD')
            AND job_salary->>'minimum' IS NOT NULL
            THEN round(
              (job_salary->>'minimum')::numeric
              * CASE job_salary->>'currency'
                  WHEN 'EUR' THEN 1 WHEN 'USD' THEN 0.86 WHEN 'GBP' THEN 1.16 WHEN 'CAD' THEN 0.63
                END
              / CASE requested_salary->>'currency'
                  WHEN 'EUR' THEN 1 WHEN 'USD' THEN 0.86 WHEN 'GBP' THEN 1.16 WHEN 'CAD' THEN 0.63
                END
            )
          ELSE NULL
        END AS converted_minimum,
        CASE
          WHEN job_salary->>'currency' = requested_salary->>'currency'
            THEN (job_salary->>'maximum')::numeric
          WHEN job_salary->>'currency' IN ('EUR', 'USD', 'GBP', 'CAD')
            AND requested_salary->>'currency' IN ('EUR', 'USD', 'GBP', 'CAD')
            AND job_salary->>'maximum' IS NOT NULL
            THEN round(
              (job_salary->>'maximum')::numeric
              * CASE job_salary->>'currency'
                  WHEN 'EUR' THEN 1 WHEN 'USD' THEN 0.86 WHEN 'GBP' THEN 1.16 WHEN 'CAD' THEN 0.63
                END
              / CASE requested_salary->>'currency'
                  WHEN 'EUR' THEN 1 WHEN 'USD' THEN 0.86 WHEN 'GBP' THEN 1.16 WHEN 'CAD' THEN 0.63
                END
            )
          ELSE NULL
        END AS converted_maximum
      FROM salary_amounts
    ),
    salary_scored AS (
      SELECT converted_salary.*, salary.score AS salary_score
      FROM converted_salary
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN requested_salary IS NULL THEN 1.0
          WHEN requested_salary->>'unknownPolicy' = 'only'
            THEN CASE WHEN job_salary IS NULL THEN 1.0 ELSE NULL END
          WHEN job_salary IS NULL
            THEN CASE WHEN requested_salary->>'unknownPolicy' = 'include' THEN 0.4 ELSE NULL END
          WHEN requested_salary->>'minimum' IS NULL
            AND requested_salary->>'maximum' IS NULL THEN 1.0
          WHEN job_salary->>'period' <> requested_salary->>'period'
            THEN CASE WHEN requested_salary->>'unknownPolicy' = 'include' THEN 0.4 ELSE NULL END
          WHEN converted_minimum IS NULL AND converted_maximum IS NULL
            THEN CASE WHEN requested_salary->>'unknownPolicy' = 'include' THEN 0.4 ELSE NULL END
          WHEN requested_salary->>'minimum' IS NOT NULL AND converted_minimum IS NULL
            THEN CASE WHEN requested_salary->>'unknownPolicy' = 'include' THEN 0.4 ELSE NULL END
          WHEN requested_salary->>'maximum' IS NOT NULL AND converted_maximum IS NULL
            THEN CASE WHEN requested_salary->>'unknownPolicy' = 'include' THEN 0.4 ELSE NULL END
          WHEN requested_salary->>'minimum' IS NOT NULL
            AND coalesce(converted_maximum, converted_minimum)
              < (requested_salary->>'minimum')::numeric THEN NULL
          WHEN requested_salary->>'maximum' IS NOT NULL
            AND converted_minimum > (requested_salary->>'maximum')::numeric THEN NULL
          WHEN requested_salary->>'minimum' IS NOT NULL
            AND converted_minimum < (requested_salary->>'minimum')::numeric THEN 0.7
          ELSE 1.0
        END::double precision AS score
      ) AS salary
      WHERE salary.score IS NOT NULL
    ),
    dimensions AS (
      SELECT
        salary_scored.*,
        (
          SELECT count(*)::double precision
          FROM jsonb_array_elements_text(criteria->'categories') AS requested(value)
          WHERE requested.value = ANY(categories)
        ) AS category_matches,
        (
          SELECT count(*)::double precision
          FROM jsonb_array_elements_text(criteria->'workModels') AS requested(value)
          WHERE requested.value = work_model
        ) AS work_model_matches,
        (
          SELECT count(*)::double precision
          FROM jsonb_array_elements_text(criteria->'seniorities') AS requested(value)
          WHERE requested.value = seniority
        ) AS seniority_matches,
        (
          SELECT count(*)::double precision
          FROM jsonb_array_elements_text(criteria->'locations') AS requested(value)
          CROSS JOIN LATERAL (
            SELECT jobbbler.normalize_search_text(requested.value) AS term
          ) AS normalized
          WHERE normalized.term <> ''
            AND EXISTS (
              SELECT 1
              FROM unnest(location_terms) AS actual(term)
              WHERE actual.term <> ''
                AND (
                  strpos(actual.term, normalized.term) > 0
                  OR strpos(normalized.term, actual.term) > 0
                )
            )
        ) AS location_matches,
        (
          SELECT count(*)::double precision
          FROM jsonb_array_elements_text(criteria->'skills') AS requested(value)
          WHERE jobbbler.normalize_search_text(requested.value) = ANY(skill_terms)
        ) AS skill_matches
      FROM salary_scored
    ),
    ranked AS MATERIALIZED (
      SELECT
        dimensions.*,
        CASE criteria->>'sort'
          WHEN 'relevance' THEN
            CASE
              WHEN (
                CASE WHEN criteria->>'query' IS NULL THEN 0 ELSE 30 END
                + CASE WHEN jsonb_array_length(criteria->'categories') = 0 THEN 0 ELSE 15 END
                + CASE WHEN jsonb_array_length(criteria->'workModels') = 0 THEN 0 ELSE 10 END
                + CASE WHEN jsonb_array_length(criteria->'seniorities') = 0 THEN 0 ELSE 10 END
                + CASE WHEN jsonb_array_length(criteria->'locations') = 0 THEN 0 ELSE 10 END
                + CASE WHEN jsonb_array_length(criteria->'skills') = 0 THEN 0 ELSE 15 END
                + CASE WHEN requested_salary IS NULL THEN 0 ELSE 10 END
                + CASE WHEN criteria->>'postedWithinDays' IS NULL THEN 0 ELSE 5 END
              ) = 0 THEN 50
              ELSE round(100 * (
                CASE WHEN criteria->>'query' IS NULL THEN 0 ELSE 30 END
                + CASE WHEN jsonb_array_length(criteria->'categories') = 0 THEN 0
                    ELSE 15 * category_matches / jsonb_array_length(criteria->'categories') END
                + CASE WHEN jsonb_array_length(criteria->'workModels') = 0 THEN 0
                    ELSE 10 * work_model_matches / jsonb_array_length(criteria->'workModels') END
                + CASE WHEN jsonb_array_length(criteria->'seniorities') = 0 THEN 0
                    ELSE 10 * seniority_matches / jsonb_array_length(criteria->'seniorities') END
                + CASE WHEN jsonb_array_length(criteria->'locations') = 0 THEN 0
                    ELSE 10 * location_matches / jsonb_array_length(criteria->'locations') END
                + CASE WHEN jsonb_array_length(criteria->'skills') = 0 THEN 0
                    ELSE 15 * skill_matches / jsonb_array_length(criteria->'skills') END
                + CASE WHEN requested_salary IS NULL THEN 0 ELSE 10 * salary_score END
                + CASE WHEN criteria->>'postedWithinDays' IS NULL THEN 0 ELSE 5 END
              ) / (
                CASE WHEN criteria->>'query' IS NULL THEN 0 ELSE 30 END
                + CASE WHEN jsonb_array_length(criteria->'categories') = 0 THEN 0 ELSE 15 END
                + CASE WHEN jsonb_array_length(criteria->'workModels') = 0 THEN 0 ELSE 10 END
                + CASE WHEN jsonb_array_length(criteria->'seniorities') = 0 THEN 0 ELSE 10 END
                + CASE WHEN jsonb_array_length(criteria->'locations') = 0 THEN 0 ELSE 10 END
                + CASE WHEN jsonb_array_length(criteria->'skills') = 0 THEN 0 ELSE 15 END
                + CASE WHEN requested_salary IS NULL THEN 0 ELSE 10 END
                + CASE WHEN criteria->>'postedWithinDays' IS NULL THEN 0 ELSE 5 END
              ))
            END
          WHEN 'salary_desc' THEN salary_sort
          ELSE 0
        END::double precision AS primary_sort
      FROM dimensions
    ),
    stats AS (
      SELECT
        count(*)::text AS total,
        (array_agg(body->>'updatedAt' ORDER BY catalog_updated_at DESC, job_id))[1]
          AS catalog_updated_at
      FROM ranked
    ),
    limited AS (
      SELECT ranked.*
      FROM ranked
      CROSS JOIN input
      WHERE input.cursor_id IS NULL
        OR (ranked.criteria->>'sort' <> 'newest' AND primary_sort < input.cursor_primary)
        OR (
          (ranked.criteria->>'sort' = 'newest' OR primary_sort = input.cursor_primary)
          AND published_at < input.cursor_published_at
        )
        OR (
          (ranked.criteria->>'sort' = 'newest' OR primary_sort = input.cursor_primary)
          AND published_at = input.cursor_published_at
          AND job_id > input.cursor_id
        )
      ORDER BY
        CASE WHEN ranked.criteria->>'sort' <> 'newest' THEN primary_sort END DESC,
        published_at DESC,
        job_id
      LIMIT (SELECT page_limit FROM input)
    ),
    page AS (
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'body', body,
            'primary', primary_sort,
            'published_at', body->>'publishedAt',
            'job_id', job_id
          )
          ORDER BY
            CASE WHEN criteria->>'sort' <> 'newest' THEN primary_sort END DESC,
            published_at DESC,
            job_id
        ),
        '[]'::jsonb
      ) AS entries
      FROM limited
    )
    SELECT stats.total, stats.catalog_updated_at, page.entries AS page
    FROM stats
    CROSS JOIN page`;

  const result = rows[0];
  if (result === undefined) throw new TypeError("PostgreSQL search returned no result row.");
  const entries = result.page.map(parsePageEntry);
  const hasNextPage = entries.length > effectiveLimit;
  const page = entries.slice(0, effectiveLimit);
  const last = page.at(-1);
  return {
    jobs: page.map(({ job }) => job),
    total: Number(result.total),
    nextCursor: hasNextPage && last !== undefined ? encodeCursor(last, query.criteria) : null,
    catalogUpdatedAt: result.catalog_updated_at,
  };
}
