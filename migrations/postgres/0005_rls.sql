ALTER TABLE jobbbler.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobbbler.entity_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobbbler.rate_limit_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobbbler.migration_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobbbler.migration_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobbbler.job_search_documents ENABLE ROW LEVEL SECURITY;

-- Public catalog reads are deliberately limited to open jobs. All other rows
-- remain deny-by-default unless the authenticated principal owns them.
CREATE POLICY entity_records_public_open_jobs
  ON jobbbler.entity_records FOR SELECT TO anon, authenticated
  USING (kind = 'job' AND body->>'status' = 'open');
CREATE POLICY entity_records_owner_only
  ON jobbbler.entity_records FOR ALL TO authenticated
  USING (owner_id = jobbbler.current_owner_id())
  WITH CHECK (owner_id = jobbbler.current_owner_id());
CREATE POLICY job_search_public_open_jobs
  ON jobbbler.job_search_documents FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM jobbbler.entity_records records
    WHERE records.kind = 'job' AND records.id = job_id AND records.body->>'status' = 'open'
  ));

REVOKE ALL ON SCHEMA jobbbler FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA jobbbler FROM anon, authenticated;
GRANT USAGE ON SCHEMA jobbbler TO anon, authenticated;
GRANT SELECT ON jobbbler.entity_records, jobbbler.job_search_documents TO anon, authenticated;
