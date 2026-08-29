CREATE OR REPLACE FUNCTION jobbbler.current_owner_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.owner_id', true), '') $$;

CREATE OR REPLACE FUNCTION jobbbler.import_snapshot_row(
  p_snapshot_id text,
  p_kind text,
  p_id text,
  p_owner_id text,
  p_body jsonb,
  p_version integer,
  p_created_at timestamptz,
  p_updated_at timestamptz
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jobbbler.migration_snapshots WHERE id = p_snapshot_id AND status = 'importing') THEN
    RAISE EXCEPTION 'snapshot is not importing';
  END IF;
  INSERT INTO jobbbler.entity_records(kind, id, owner_id, body, version, created_at, updated_at)
  VALUES (p_kind, p_id, p_owner_id, p_body, p_version, p_created_at, p_updated_at)
  ON CONFLICT (kind, id) DO UPDATE SET
    owner_id = EXCLUDED.owner_id,
    body = EXCLUDED.body,
    version = EXCLUDED.version,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;
END;
$$;
