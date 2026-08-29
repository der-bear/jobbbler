CREATE TABLE jobbbler.job_search_documents (
  job_id text PRIMARY KEY,
  document tsvector NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_search_documents_gin_idx
  ON jobbbler.job_search_documents USING gin(document);

CREATE OR REPLACE FUNCTION jobbbler.refresh_job_search_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind = 'job' THEN
    INSERT INTO jobbbler.job_search_documents(job_id, document, updated_at)
    VALUES (
      NEW.id,
      to_tsvector('simple', coalesce(NEW.body->>'title', '') || ' ' ||
                           coalesce(NEW.body->>'summary', '') || ' ' ||
                           coalesce(NEW.body->>'organizationName', '') || ' ' ||
                           coalesce(NEW.body->'skills', '[]'::jsonb)::text),
      now()
    )
    ON CONFLICT (job_id) DO UPDATE
      SET document = EXCLUDED.document, updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION jobbbler.remove_job_search_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.kind = 'job' THEN DELETE FROM jobbbler.job_search_documents WHERE job_id = OLD.id; END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER entity_records_job_search_after_write
AFTER INSERT OR UPDATE OF body ON jobbbler.entity_records
FOR EACH ROW EXECUTE FUNCTION jobbbler.refresh_job_search_document();
CREATE TRIGGER entity_records_job_search_after_delete
AFTER DELETE ON jobbbler.entity_records
FOR EACH ROW EXECUTE FUNCTION jobbbler.remove_job_search_document();
