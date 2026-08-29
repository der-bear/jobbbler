CREATE SCHEMA IF NOT EXISTS jobbbler;

CREATE TABLE IF NOT EXISTS jobbbler.schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL UNIQUE,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Portable records retain application-generated identifiers and canonical JSON.
-- owner_id is duplicated for row-level security without exposing private payloads.
CREATE TABLE jobbbler.entity_records (
  kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 96),
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 256),
  owner_id text,
  body jsonb NOT NULL,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);

CREATE INDEX entity_records_kind_owner_updated_idx
  ON jobbbler.entity_records(kind, owner_id, updated_at DESC, id);
CREATE INDEX entity_records_body_gin_idx ON jobbbler.entity_records USING gin(body jsonb_path_ops);

CREATE TABLE jobbbler.rate_limit_windows (
  key text PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 512),
  count integer NOT NULL CHECK (count >= 0),
  reset_at_ms bigint NOT NULL CHECK (reset_at_ms >= 0)
);
CREATE INDEX rate_limit_windows_reset_idx ON jobbbler.rate_limit_windows(reset_at_ms);

CREATE TABLE jobbbler.migration_snapshots (
  id text PRIMARY KEY,
  format_version integer NOT NULL,
  checksum text NOT NULL,
  row_count integer NOT NULL CHECK (row_count >= 0),
  status text NOT NULL CHECK (status IN ('staged', 'importing', 'imported', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE jobbbler.migration_rows (
  snapshot_id text NOT NULL REFERENCES jobbbler.migration_snapshots(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  table_name text NOT NULL,
  row_id text,
  payload jsonb NOT NULL,
  PRIMARY KEY (snapshot_id, ordinal)
);
