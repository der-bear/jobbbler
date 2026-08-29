CREATE VIRTUAL TABLE jobs_fts USING fts5(
  job_id UNINDEXED,
  title,
  organization_name,
  summary,
  skills,
  locations,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO jobs_fts(job_id, title, organization_name, summary, skills, locations)
SELECT id, title, organization_name, summary, skills_json, locations_json FROM jobs;

CREATE TRIGGER jobs_fts_after_insert AFTER INSERT ON jobs BEGIN
  INSERT INTO jobs_fts(job_id, title, organization_name, summary, skills, locations)
  VALUES (new.id, new.title, new.organization_name, new.summary, new.skills_json, new.locations_json);
END;

CREATE TRIGGER jobs_fts_after_update AFTER UPDATE ON jobs BEGIN
  DELETE FROM jobs_fts WHERE job_id = old.id;
  INSERT INTO jobs_fts(job_id, title, organization_name, summary, skills, locations)
  VALUES (new.id, new.title, new.organization_name, new.summary, new.skills_json, new.locations_json);
END;

CREATE TRIGGER jobs_fts_after_delete AFTER DELETE ON jobs BEGIN
  DELETE FROM jobs_fts WHERE job_id = old.id;
END;
