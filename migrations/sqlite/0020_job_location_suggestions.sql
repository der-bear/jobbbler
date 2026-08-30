CREATE TABLE job_location_suggestions (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  value TEXT NOT NULL CHECK (trim(value) <> ''),
  normalized_value TEXT NOT NULL CHECK (normalized_value = lower(trim(value))),
  PRIMARY KEY (job_id, normalized_value)
) STRICT;

CREATE INDEX job_location_suggestions_prefix_idx
  ON job_location_suggestions(normalized_value, job_id);

INSERT OR REPLACE INTO job_location_suggestions(job_id, value, normalized_value)
SELECT jobs.id, min(trim(location.value)), lower(trim(location.value))
FROM jobs
JOIN json_each(jobs.locations_json) AS location
WHERE jobs.status = 'open' AND trim(location.value) <> ''
GROUP BY jobs.id, lower(trim(location.value));

CREATE TRIGGER jobs_location_suggestions_after_insert
AFTER INSERT ON jobs
WHEN NEW.status = 'open'
BEGIN
  INSERT OR REPLACE INTO job_location_suggestions(job_id, value, normalized_value)
  SELECT NEW.id, min(trim(location.value)), lower(trim(location.value))
  FROM json_each(NEW.locations_json) AS location
  WHERE trim(location.value) <> ''
  GROUP BY lower(trim(location.value));
END;

CREATE TRIGGER jobs_location_suggestions_after_update
AFTER UPDATE OF locations_json, status ON jobs
BEGIN
  DELETE FROM job_location_suggestions WHERE job_id = NEW.id;
  INSERT OR REPLACE INTO job_location_suggestions(job_id, value, normalized_value)
  SELECT NEW.id, min(trim(location.value)), lower(trim(location.value))
  FROM json_each(NEW.locations_json) AS location
  WHERE NEW.status = 'open' AND trim(location.value) <> ''
  GROUP BY lower(trim(location.value));
END;
