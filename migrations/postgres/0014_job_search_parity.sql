-- Operational release constraint: this migration uses the transactional
-- migration runner, so its ALTER TABLE and index replacement are deliberately
-- supported only before the PostgreSQL catalog is populated. A populated
-- deployment must use a separately rehearsed online migration instead.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM jobbbler.entity_records WHERE kind = 'job' LIMIT 1
  ) OR EXISTS (
    SELECT 1 FROM jobbbler.job_search_documents LIMIT 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'PostgreSQL migration 0014 requires an empty job catalog; apply it before import or ingestion.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION jobbbler.normalize_search_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            translate(
              lower(normalize(coalesce(value, ''), NFKD)),
              U&'\005e\0060\00a8\00af\00b4\00b7\00b8',
              ''
            ),
            U&'[\0300-\036f\1ab0-\1aff\1dc0-\1dff\20d0-\20ff\fe20-\fe2f]',
            '',
            'g'
          ),
          '[_-]+',
          ' ',
          'g'
        ),
        '[^[:alnum:]+#. ]+',
        ' ',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$$;

ALTER TABLE jobbbler.job_search_documents
  ADD COLUMN published_at_ms bigint;
ALTER TABLE jobbbler.job_search_documents
  ALTER COLUMN published_at_ms SET NOT NULL;

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
      coalesce(
        (NEW.body#>>'{salary,maximum}')::double precision,
        (NEW.body#>>'{salary,minimum}')::double precision,
        -1
      ),
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

DROP INDEX jobbbler.job_search_documents_open_newest_idx;
DROP INDEX jobbbler.job_search_documents_open_salary_idx;
DROP INDEX jobbbler.job_search_documents_open_work_model_idx;
DROP INDEX jobbbler.job_search_documents_open_seniority_idx;

CREATE INDEX job_search_documents_open_newest_idx
  ON jobbbler.job_search_documents(published_at_ms DESC, job_id)
  WHERE status = 'open';
CREATE INDEX job_search_documents_open_salary_idx
  ON jobbbler.job_search_documents(salary_sort DESC, published_at_ms DESC, job_id)
  WHERE status = 'open';
CREATE INDEX job_search_documents_open_work_model_idx
  ON jobbbler.job_search_documents(work_model, published_at_ms DESC, job_id)
  WHERE status = 'open';
CREATE INDEX job_search_documents_open_seniority_idx
  ON jobbbler.job_search_documents(seniority, published_at_ms DESC, job_id)
  WHERE status = 'open';

REVOKE EXECUTE ON FUNCTION jobbbler.normalize_search_text(text) FROM PUBLIC, anon, authenticated;
