CREATE OR REPLACE FUNCTION jobbbler.normalize_search_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(normalize(coalesce(value, ''), NFKD)), '[_-]+', ' ', 'g'),
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

CREATE OR REPLACE FUNCTION jobbbler.job_search_document_text(job_body jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT concat_ws(
    ' ',
    job_body->>'title',
    job_body->>'organizationName',
    job_body->>'summary',
    (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(coalesce(job_body->'categories', '[]'::jsonb)) AS category(value)),
    (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(coalesce(job_body->'locations', '[]'::jsonb)) AS location(value)),
    (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(coalesce(job_body->'skills', '[]'::jsonb)) AS skill(value))
  )
$$;

ALTER TABLE jobbbler.job_search_documents
  ADD COLUMN body jsonb,
  ADD COLUMN status text,
  ADD COLUMN published_at timestamptz,
  ADD COLUMN catalog_updated_at timestamptz,
  ADD COLUMN work_model text,
  ADD COLUMN seniority text,
  ADD COLUMN salary_sort double precision,
  ADD COLUMN normalized_text text,
  ADD COLUMN categories text[],
  ADD COLUMN location_terms text[],
  ADD COLUMN skill_terms text[];

UPDATE jobbbler.job_search_documents AS search
SET
  body = records.body,
  status = records.body->>'status',
  published_at = (records.body->>'publishedAt')::timestamptz,
  catalog_updated_at = (records.body->>'updatedAt')::timestamptz,
  work_model = records.body->>'workModel',
  seniority = records.body->>'seniority',
  salary_sort = coalesce(
    (records.body#>>'{salary,maximum}')::double precision,
    (records.body#>>'{salary,minimum}')::double precision,
    -1
  ),
  normalized_text = jobbbler.normalize_search_text(jobbbler.job_search_document_text(records.body)),
  categories = ARRAY(
    SELECT value
    FROM jsonb_array_elements_text(coalesce(records.body->'categories', '[]'::jsonb)) AS category(value)
  ),
  location_terms = ARRAY(
    SELECT jobbbler.normalize_search_text(value)
    FROM jsonb_array_elements_text(coalesce(records.body->'locations', '[]'::jsonb)) AS location(value)
  ),
  skill_terms = ARRAY(
    SELECT jobbbler.normalize_search_text(value)
    FROM jsonb_array_elements_text(coalesce(records.body->'skills', '[]'::jsonb)) AS skill(value)
  ),
  document = to_tsvector('simple', jobbbler.job_search_document_text(records.body))
FROM jobbbler.entity_records AS records
WHERE records.kind = 'job' AND records.id = search.job_id;

DELETE FROM jobbbler.job_search_documents AS search
WHERE NOT EXISTS (
  SELECT 1
  FROM jobbbler.entity_records AS records
  WHERE records.kind = 'job' AND records.id = search.job_id
);

ALTER TABLE jobbbler.job_search_documents
  ALTER COLUMN body SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN published_at SET NOT NULL,
  ALTER COLUMN catalog_updated_at SET NOT NULL,
  ALTER COLUMN work_model SET NOT NULL,
  ALTER COLUMN salary_sort SET NOT NULL,
  ALTER COLUMN normalized_text SET NOT NULL,
  ALTER COLUMN categories SET NOT NULL,
  ALTER COLUMN location_terms SET NOT NULL,
  ALTER COLUMN skill_terms SET NOT NULL,
  ADD CONSTRAINT job_search_documents_status_check
    CHECK (status IN ('open', 'closed', 'stale'));

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

DROP INDEX jobbbler.job_search_documents_gin_idx;
CREATE INDEX job_search_documents_gin_idx
  ON jobbbler.job_search_documents USING gin(document)
  WHERE status = 'open';
CREATE INDEX job_search_documents_open_newest_idx
  ON jobbbler.job_search_documents(published_at DESC, job_id)
  WHERE status = 'open';
CREATE INDEX job_search_documents_open_salary_idx
  ON jobbbler.job_search_documents(salary_sort DESC, published_at DESC, job_id)
  WHERE status = 'open';
CREATE INDEX job_search_documents_open_work_model_idx
  ON jobbbler.job_search_documents(work_model, published_at DESC, job_id)
  WHERE status = 'open';
CREATE INDEX job_search_documents_open_seniority_idx
  ON jobbbler.job_search_documents(seniority, published_at DESC, job_id)
  WHERE status = 'open';
CREATE INDEX job_search_documents_open_categories_idx
  ON jobbbler.job_search_documents USING gin(categories)
  WHERE status = 'open';

DROP POLICY job_search_public_open_jobs ON jobbbler.job_search_documents;
CREATE POLICY job_search_public_open_jobs
  ON jobbbler.job_search_documents FOR SELECT TO anon, authenticated
  USING (status = 'open');

REVOKE EXECUTE ON FUNCTION jobbbler.normalize_search_text(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION jobbbler.job_search_document_text(jsonb) FROM PUBLIC, anon, authenticated;
