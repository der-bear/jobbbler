-- Pin trusted function lookup so callers cannot influence resolution through
-- their session search_path. All durable relations and application functions
-- referenced by these bodies are schema-qualified.
ALTER FUNCTION jobbbler.current_owner_id()
  SET search_path = '';
ALTER FUNCTION jobbbler.import_snapshot_row(text, text, text, text, jsonb, integer, timestamptz, timestamptz)
  SET search_path = '';
ALTER FUNCTION jobbbler.job_search_document_text(jsonb)
  SET search_path = '';
ALTER FUNCTION jobbbler.refresh_job_search_document()
  SET search_path = '';
ALTER FUNCTION jobbbler.remove_job_search_document()
  SET search_path = '';
ALTER FUNCTION jobbbler.normalize_search_text(text)
  SET search_path = '';
ALTER FUNCTION jobbbler.annualized_salary_sort_value(jsonb)
  SET search_path = '';

-- Supabase Realtime is optional in portable PostgreSQL. When present, replace
-- the owner-scoped read policy with an init-plan-safe auth.jwt() lookup.
DO $jobbbler$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL
     AND to_regprocedure('realtime.topic()') IS NOT NULL
     AND to_regprocedure('auth.jwt()') IS NOT NULL
  THEN
    EXECUTE 'DROP POLICY IF EXISTS jobbbler_owner_activity_wakeup_read ON realtime.messages';
    EXECUTE $policy$
      CREATE POLICY jobbbler_owner_activity_wakeup_read
        ON realtime.messages
        FOR SELECT
        TO authenticated
        USING (
          realtime.topic() = 'owner_activity:' || coalesce(
            (SELECT auth.jwt()) -> 'app_metadata' ->> 'jobbbler_owner_id',
            ''
          )
        )
    $policy$;
  END IF;
END
$jobbbler$;

-- Keep public catalog access and owner access unchanged while ensuring each
-- role/action has a single permissive policy. Server-side writes remain the
-- normal path; the mutation policies preserve the prior authenticated-owner
-- semantics for any future explicitly granted DML operation.
DROP POLICY entity_records_public_open_jobs ON jobbbler.entity_records;
DROP POLICY entity_records_owner_only ON jobbbler.entity_records;

CREATE POLICY entity_records_public_open_jobs
  ON jobbbler.entity_records FOR SELECT TO anon
  USING (kind = 'job' AND body->>'status' = 'open');

CREATE POLICY entity_records_authenticated_read
  ON jobbbler.entity_records FOR SELECT TO authenticated
  USING (
    (kind = 'job' AND body->>'status' = 'open')
    OR owner_id = (SELECT jobbbler.current_owner_id())
  );

CREATE POLICY entity_records_owner_insert
  ON jobbbler.entity_records FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT jobbbler.current_owner_id()));

CREATE POLICY entity_records_owner_update
  ON jobbbler.entity_records FOR UPDATE TO authenticated
  USING (owner_id = (SELECT jobbbler.current_owner_id()))
  WITH CHECK (owner_id = (SELECT jobbbler.current_owner_id()));

CREATE POLICY entity_records_owner_delete
  ON jobbbler.entity_records FOR DELETE TO authenticated
  USING (owner_id = (SELECT jobbbler.current_owner_id()));
