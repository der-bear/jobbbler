CREATE OR REPLACE FUNCTION jobbbler.annualized_salary_sort_value(salary jsonb)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(
    round(
      (
        coalesce(
          (salary->>'maximum')::double precision,
          (salary->>'minimum')::double precision
        )
        * CASE salary->>'currency'
            WHEN 'EUR' THEN 1
            WHEN 'USD' THEN 0.86
            WHEN 'GBP' THEN 1.16
            WHEN 'CAD' THEN 0.63
          END
      )::numeric
    )::double precision
    * CASE salary->>'period'
        WHEN 'year' THEN 1
        WHEN 'month' THEN 12
        WHEN 'hour' THEN 2080
      END,
    -1
  )
$$;

UPDATE jobbbler.job_search_documents
SET salary_sort = jobbbler.annualized_salary_sort_value(
  NULLIF(body->'salary', 'null'::jsonb)
);

CREATE OR REPLACE FUNCTION jobbbler.refresh_job_search_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind = 'job' THEN
    INSERT INTO jobbbler.job_search_documents(
      job_id,
      document,
      updated_at,
      body,
      status,
      published_at,
      published_at_ms,
      catalog_updated_at,
      work_model,
      seniority,
      salary_sort,
      normalized_text,
      categories,
      location_terms,
      skill_terms
    )
    VALUES (
      NEW.id,
      to_tsvector('simple', jobbbler.job_search_document_text(NEW.body)),
      now(),
      NEW.body,
      NEW.body->>'status',
      (NEW.body->>'publishedAt')::timestamptz,
      trunc(extract(epoch FROM (NEW.body->>'publishedAt')::timestamptz) * 1000)::bigint,
      (NEW.body->>'updatedAt')::timestamptz,
      NEW.body->>'workModel',
      NEW.body->>'seniority',
      jobbbler.annualized_salary_sort_value(NULLIF(NEW.body->'salary', 'null'::jsonb)),
      jobbbler.normalize_search_text(jobbbler.job_search_document_text(NEW.body)),
      ARRAY(
        SELECT value
        FROM jsonb_array_elements_text(coalesce(NEW.body->'categories', '[]'::jsonb)) AS category(value)
      ),
      ARRAY(
        SELECT jobbbler.normalize_search_text(value)
        FROM jsonb_array_elements_text(coalesce(NEW.body->'locations', '[]'::jsonb)) AS location(value)
      ),
      ARRAY(
        SELECT jobbbler.normalize_search_text(value)
        FROM jsonb_array_elements_text(coalesce(NEW.body->'skills', '[]'::jsonb)) AS skill(value)
      )
    )
    ON CONFLICT (job_id) DO UPDATE SET
      document = EXCLUDED.document,
      updated_at = EXCLUDED.updated_at,
      body = EXCLUDED.body,
      status = EXCLUDED.status,
      published_at = EXCLUDED.published_at,
      published_at_ms = EXCLUDED.published_at_ms,
      catalog_updated_at = EXCLUDED.catalog_updated_at,
      work_model = EXCLUDED.work_model,
      seniority = EXCLUDED.seniority,
      salary_sort = EXCLUDED.salary_sort,
      normalized_text = EXCLUDED.normalized_text,
      categories = EXCLUDED.categories,
      location_terms = EXCLUDED.location_terms,
      skill_terms = EXCLUDED.skill_terms;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION jobbbler.annualized_salary_sort_value(jsonb)
  FROM PUBLIC, anon, authenticated;
