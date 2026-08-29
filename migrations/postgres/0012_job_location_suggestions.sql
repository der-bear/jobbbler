CREATE TABLE jobbbler.job_location_suggestions (
  job_id text NOT NULL,
  value text NOT NULL CHECK (btrim(value) <> ''),
  normalized_value text NOT NULL CHECK (normalized_value = lower(btrim(value))),
  PRIMARY KEY (job_id, normalized_value)
);

CREATE INDEX job_location_suggestions_prefix_idx
  ON jobbbler.job_location_suggestions(normalized_value, job_id);

CREATE OR REPLACE FUNCTION jobbbler.sync_job_location_suggestions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobbbler
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.kind = 'job' THEN
      DELETE FROM jobbbler.job_location_suggestions WHERE job_id = OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.kind = 'job' THEN
    DELETE FROM jobbbler.job_location_suggestions WHERE job_id = OLD.id;
  END IF;

  IF NEW.kind = 'job' AND NEW.body->>'status' = 'open' THEN
    INSERT INTO jobbbler.job_location_suggestions(job_id, value, normalized_value)
    SELECT NEW.id, min(btrim(location.value)), lower(btrim(location.value))
    FROM jsonb_array_elements_text(NEW.body->'locations') AS location(value)
    WHERE btrim(location.value) <> ''
    GROUP BY lower(btrim(location.value))
    ON CONFLICT (job_id, normalized_value) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER entity_records_sync_job_location_suggestions
AFTER INSERT OR UPDATE OR DELETE ON jobbbler.entity_records
FOR EACH ROW EXECUTE FUNCTION jobbbler.sync_job_location_suggestions();

INSERT INTO jobbbler.job_location_suggestions(job_id, value, normalized_value)
SELECT job.id, min(btrim(location.value)), lower(btrim(location.value))
FROM jobbbler.entity_records AS job
CROSS JOIN LATERAL jsonb_array_elements_text(job.body->'locations') AS location(value)
WHERE job.kind = 'job'
  AND job.body->>'status' = 'open'
  AND btrim(location.value) <> ''
GROUP BY job.id, lower(btrim(location.value))
ON CONFLICT (job_id, normalized_value) DO UPDATE SET value = EXCLUDED.value;

ALTER TABLE jobbbler.job_location_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jobbbler.job_location_suggestions FROM PUBLIC, anon, authenticated;
