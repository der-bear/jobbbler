import { parseJob } from "@jobbbler/jobs-domain";
import {
  decodeJobSearchCursor,
  encodeJobSearchCursor,
  jobSearchPublishedAtMs,
  type Job,
  type JobSearchPage,
  type JobSearchQuery,
} from "@jobbbler/storage";

import type { PostgresSql } from "./connection.js";

interface SearchRow {
  readonly total: string;
  readonly catalog_updated_at: string | null;
  readonly body: unknown | null;
  readonly primary: number | string | null;
  readonly job_id: string | null;
}

interface ParsedPageEntry {
  readonly job: Job;
  readonly primary: number;
}

function parsePageEntry(row: SearchRow): ParsedPageEntry | null {
  if (row.body === null && row.primary === null && row.job_id === null) return null;
  if (row.body === null || row.primary === null || row.job_id === null) {
    throw new TypeError("PostgreSQL search returned an incomplete projection row.");
  }
  const primary = Number(row.primary);
  if (!Number.isFinite(primary)) throw new TypeError("PostgreSQL search returned an invalid rank.");
  const job = parseJob(row.body);
  if (row.job_id !== job.id) {
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
    query.criteria.cursor === null
      ? null
      : decodeJobSearchCursor(query.criteria.cursor, query.criteria);
  const rows = await sql<SearchRow[]>`
    WITH input AS NOT MATERIALIZED (
      SELECT
        ${sql.json(query.criteria)}::jsonb AS criteria,
        ${jobSearchPublishedAtMs(query.now)}::bigint AS now_ms,
        ${effectiveLimit + 1}::integer AS page_limit,
        ${cursor?.primary ?? null}::double precision AS cursor_primary,
        ${cursor?.publishedAtMs ?? null}::bigint AS cursor_published_at_ms,
        ${cursor?.id ?? null}::text AS cursor_id
    ),
    candidates AS NOT MATERIALIZED (
      SELECT
        search.job_id,
        search.catalog_updated_at,
        search.published_at_ms,
        search.salary_sort,
        search.categories,
        search.work_model,
        search.seniority,
        search.location_terms,
        search.skill_terms,
        search.body,
        NULLIF(search.body->'salary', 'null'::jsonb) AS job_salary,
        input.criteria
      FROM jobbbler.job_search_documents AS search
      CROSS JOIN input
      WHERE search.status = 'open'
        AND (
          ${query.criteria.query === null}::boolean
          OR search.document @@ plainto_tsquery('simple', ${query.criteria.query ?? ""})
        )
        AND (
          ${query.criteria.categories.length === 0}::boolean
          OR search.categories && ${sql.array(query.criteria.categories)}::text[]
        )
        AND (
          ${query.criteria.workModels.length === 0}::boolean
          OR search.work_model = ANY(${sql.array(query.criteria.workModels)}::text[])
        )
        AND (
          ${(query.criteria.employmentTypes ?? []).length === 0}::boolean
          OR search.body->>'employmentType' = ANY(${sql.array(query.criteria.employmentTypes ?? [])}::text[])
        )
        AND (
          ${query.criteria.seniorities.length === 0}::boolean
          OR search.seniority = ANY(${sql.array(query.criteria.seniorities)}::text[])
        )
        AND (
          ${query.criteria.locations.length === 0}::boolean
          OR EXISTS (
            SELECT 1
            FROM unnest(${sql.array(query.criteria.locations)}::text[]) AS requested(value)
            CROSS JOIN LATERAL (
              SELECT jobbbler.normalize_search_text(requested.value) AS term
            ) AS normalized
            WHERE normalized.term <> ''
              AND EXISTS (
                SELECT 1
                FROM unnest(search.location_terms) AS actual(term)
                WHERE actual.term <> ''
                  AND strpos(actual.term, normalized.term) > 0
              )
          )
        )
        AND (
          ${query.criteria.postedWithinDays === null}::boolean
          OR search.published_at_ms BETWEEN
            input.now_ms - ${query.criteria.postedWithinDays ?? 0}::bigint * 86400000
            AND input.now_ms
        )
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(${sql.array(query.criteria.excludeKeywords)}::text[]) AS requested(value)
          CROSS JOIN LATERAL (
            SELECT jobbbler.normalize_search_text(requested.value) AS term
          ) AS normalized
          WHERE normalized.term <> '' AND strpos(search.normalized_text, normalized.term) > 0
        )
    ),
    salary_inputs AS NOT MATERIALIZED (
      SELECT
        candidates.*,
        NULLIF(candidates.criteria->'salary', 'null'::jsonb) AS requested_salary
      FROM candidates
    ),
    converted_salary AS NOT MATERIALIZED (
      SELECT
        salary_inputs.*,
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
      FROM salary_inputs
    ),
    salary_scored AS NOT MATERIALIZED (
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
    dimensions AS NOT MATERIALIZED (
      SELECT
        salary_scored.*,
        COALESCE((
          SELECT avg(
            CASE
              WHEN strpos(jobbbler.normalize_search_text(body->>'title'), token.value) > 0 THEN 1.0
              WHEN EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(body->'skills') AS skill(value)
                WHERE strpos(jobbbler.normalize_search_text(skill.value), token.value) > 0
              ) THEN 0.9
              WHEN strpos(jobbbler.normalize_search_text(body->>'organizationName'), token.value) > 0
                THEN 0.8
              WHEN EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(body->'categories') AS category(value)
                WHERE strpos(jobbbler.normalize_search_text(category.value), token.value) > 0
              ) THEN 0.75
              WHEN EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(body->'locations') AS location(value)
                WHERE strpos(jobbbler.normalize_search_text(location.value), token.value) > 0
              ) THEN 0.6
              WHEN strpos(jobbbler.normalize_search_text(body->>'summary'), token.value) > 0 THEN 0.45
              ELSE 0.0
            END
          )
          FROM regexp_split_to_table(
            jobbbler.normalize_search_text(criteria->>'query'),
            ' +'
          ) AS token(value)
          WHERE token.value <> ''
        ), 1.0)::double precision AS text_score,
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
                AND strpos(actual.term, normalized.term) > 0
            )
        ) AS location_matches,
        (
          SELECT count(*)::double precision
          FROM jsonb_array_elements_text(criteria->'skills') AS requested(value)
          WHERE jobbbler.normalize_search_text(requested.value) = ANY(skill_terms)
        ) AS skill_matches
      FROM salary_scored
    ),
    ranked AS NOT MATERIALIZED (
      SELECT
        job_id,
        published_at_ms,
        catalog_updated_at,
        CASE criteria->>'sort'
          WHEN 'relevance' THEN
            CASE
              WHEN (
                CASE WHEN criteria->>'query' IS NULL THEN 0 ELSE 30 * text_score END
                + CASE WHEN jsonb_array_length(criteria->'categories') = 0 THEN 0 ELSE 15 END
                + CASE WHEN jsonb_array_length(criteria->'workModels') = 0 THEN 0 ELSE 10 END
                + CASE WHEN jsonb_array_length(criteria->'seniorities') = 0 THEN 0 ELSE 10 END
                + CASE WHEN jsonb_array_length(criteria->'locations') = 0 THEN 0 ELSE 10 END
                + CASE WHEN jsonb_array_length(criteria->'skills') = 0 THEN 0 ELSE 15 END
                + CASE WHEN requested_salary IS NULL THEN 0 ELSE 10 END
                + CASE WHEN criteria->>'postedWithinDays' IS NULL THEN 0 ELSE 5 END
              ) = 0 THEN 50
              ELSE floor(0.5 + 100 * (
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
          WHEN 'salary_asc' THEN
            CASE WHEN salary_sort < 0 THEN ${Number.MIN_SAFE_INTEGER}::double precision ELSE -salary_sort END
          WHEN 'updated_desc' THEN
            floor(extract(epoch FROM catalog_updated_at) * 1000)::double precision
          ELSE 0
        END::double precision AS primary_sort
      FROM dimensions
    ),
    stats AS (
      SELECT
        count(*)::text AS total,
        to_char(
          max(ranked.catalog_updated_at) AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS catalog_updated_at
      FROM ranked
    ),
    limited AS (
      SELECT ranked.*
      FROM ranked
      CROSS JOIN input
      WHERE input.cursor_id IS NULL
        OR (
          input.criteria->>'sort' <> 'newest'
          AND ranked.primary_sort < input.cursor_primary
        )
        OR (
          (
            input.criteria->>'sort' = 'newest'
            OR ranked.primary_sort = input.cursor_primary
          )
          AND ranked.published_at_ms < input.cursor_published_at_ms
        )
        OR (
          (
            input.criteria->>'sort' = 'newest'
            OR ranked.primary_sort = input.cursor_primary
          )
          AND ranked.published_at_ms = input.cursor_published_at_ms
          AND ranked.job_id > input.cursor_id
        )
      ORDER BY
        CASE
          WHEN input.criteria->>'sort' <> 'newest' THEN ranked.primary_sort
        END DESC,
        ranked.published_at_ms DESC,
        ranked.job_id
      LIMIT (SELECT page_limit FROM input)
    )
    SELECT
      stats.total,
      stats.catalog_updated_at,
      hydrated.body,
      limited.primary_sort AS primary,
      limited.job_id
    FROM stats
    CROSS JOIN input
    LEFT JOIN limited ON true
    LEFT JOIN jobbbler.job_search_documents AS hydrated
      ON hydrated.job_id = limited.job_id
    ORDER BY
      CASE
        WHEN input.criteria->>'sort' <> 'newest' THEN limited.primary_sort
      END DESC,
      limited.published_at_ms DESC,
      limited.job_id`;

  const result = rows[0];
  if (result === undefined) throw new TypeError("PostgreSQL search returned no result row.");
  const entries = rows.flatMap((row) => {
    const entry = parsePageEntry(row);
    return entry === null ? [] : [entry];
  });
  const hasNextPage = entries.length > effectiveLimit;
  const page = entries.slice(0, effectiveLimit);
  const last = page.at(-1);
  return {
    jobs: page.map(({ job }) => job),
    total: Number(result.total),
    nextCursor:
      hasNextPage && last !== undefined
        ? encodeJobSearchCursor(
            {
              primary: last.primary,
              publishedAtMs: jobSearchPublishedAtMs(last.job.publishedAt),
              id: last.job.id,
            },
            query.criteria,
          )
        : null,
    catalogUpdatedAt: result.catalog_updated_at,
  };
}
