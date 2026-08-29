CREATE TABLE source_states (
  source_key TEXT NOT NULL,
  partition TEXT NOT NULL,
  health TEXT NOT NULL CHECK (health IN ('healthy', 'degraded', 'disabled')),
  last_attempt_at TEXT,
  last_successful_at TEXT,
  next_allowed_at TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL CHECK (consecutive_failures >= 0),
  etag TEXT,
  last_modified TEXT,
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_key, partition)
) WITHOUT ROWID, STRICT;

CREATE INDEX source_states_due_idx ON source_states(health, next_allowed_at, source_key, partition);

CREATE TABLE source_runs (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  partition TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('evaluation', 'production')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'skipped')),
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  complete INTEGER CHECK (complete IS NULL OR complete IN (0, 1)),
  not_modified INTEGER NOT NULL CHECK (not_modified IN (0, 1)),
  pages_fetched INTEGER NOT NULL CHECK (pages_fetched >= 0),
  records_fetched INTEGER NOT NULL CHECK (records_fetched >= 0),
  records_accepted INTEGER NOT NULL CHECK (records_accepted >= 0),
  records_rejected INTEGER NOT NULL CHECK (records_rejected >= 0),
  records_unchanged INTEGER NOT NULL CHECK (records_unchanged >= 0),
  response_etag TEXT,
  response_last_modified TEXT,
  response_bytes INTEGER NOT NULL CHECK (response_bytes >= 0),
  error_code TEXT,
  CHECK (
    (status = 'running' AND completed_at IS NULL AND complete IS NULL)
    OR (status <> 'running' AND completed_at IS NOT NULL AND complete IS NOT NULL)
  )
) STRICT;

CREATE INDEX source_runs_source_idx
  ON source_runs(source_key, partition, started_at DESC, id);

CREATE TABLE source_records (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  partition TEXT NOT NULL,
  external_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  apply_url TEXT NOT NULL,
  source_updated_at TEXT,
  first_fetched_at TEXT NOT NULL,
  raw_hash TEXT NOT NULL CHECK (length(raw_hash) = 64),
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  attribution_label TEXT NOT NULL,
  attribution_url TEXT NOT NULL,
  attribution_required INTEGER NOT NULL CHECK (attribution_required IN (0, 1)),
  followed_link_required INTEGER NOT NULL CHECK (followed_link_required IN (0, 1)),
  UNIQUE (source_key, partition, external_id, raw_hash)
) STRICT;

CREATE INDEX source_records_identity_idx
  ON source_records(source_key, partition, external_id, first_fetched_at DESC);

CREATE TRIGGER source_records_no_update
BEFORE UPDATE ON source_records
BEGIN
  SELECT RAISE(ABORT, 'source records are immutable');
END;

CREATE TABLE source_payloads (
  source_record_id TEXT PRIMARY KEY REFERENCES source_records(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  retained_until TEXT NOT NULL
) STRICT;

CREATE INDEX source_payloads_retention_idx ON source_payloads(retained_until, source_record_id);

CREATE TABLE normalization_results (
  id TEXT PRIMARY KEY,
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
  normalizer_version INTEGER NOT NULL CHECK (normalizer_version > 0),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'quarantined')),
  reason TEXT,
  issues_json TEXT NOT NULL CHECK (json_valid(issues_json)),
  normalized_hash TEXT CHECK (normalized_hash IS NULL OR length(normalized_hash) = 64),
  recorded_at TEXT NOT NULL,
  UNIQUE (source_record_id, normalizer_version),
  CHECK (
    (status = 'accepted' AND reason IS NULL AND normalized_hash IS NOT NULL)
    OR (status <> 'accepted' AND reason IS NOT NULL AND normalized_hash IS NULL)
  )
) STRICT;

CREATE TRIGGER normalization_results_no_update
BEFORE UPDATE ON normalization_results
BEGIN
  SELECT RAISE(ABORT, 'normalization results are immutable');
END;

CREATE TABLE source_run_records (
  run_id TEXT NOT NULL REFERENCES source_runs(id) ON DELETE CASCADE,
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  normalization_result_id TEXT NOT NULL REFERENCES normalization_results(id) ON DELETE RESTRICT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (run_id, source_record_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX source_run_records_record_idx
  ON source_run_records(source_record_id, observed_at DESC, run_id);

CREATE TABLE job_versions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  normalization_result_id TEXT NOT NULL REFERENCES normalization_results(id) ON DELETE RESTRICT,
  normalized_hash TEXT NOT NULL CHECK (length(normalized_hash) = 64),
  job_json TEXT NOT NULL CHECK (json_valid(job_json)),
  observed_at TEXT NOT NULL,
  UNIQUE (job_id, normalized_hash)
) STRICT;

CREATE INDEX job_versions_job_idx ON job_versions(job_id, observed_at, id);

CREATE TRIGGER job_versions_no_update
BEFORE UPDATE ON job_versions
BEGIN
  SELECT RAISE(ABORT, 'job versions are immutable');
END;

CREATE TABLE job_source_links (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  partition TEXT NOT NULL,
  external_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  apply_url TEXT NOT NULL,
  identity_basis TEXT NOT NULL CHECK (identity_basis = 'source_id'),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'possibly_closed', 'closed')),
  missing_complete_runs INTEGER NOT NULL DEFAULT 0 CHECK (missing_complete_runs >= 0),
  last_complete_run_id TEXT REFERENCES source_runs(id) ON DELETE SET NULL,
  latest_source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  latest_source_updated_at TEXT NOT NULL,
  latest_raw_hash TEXT NOT NULL CHECK (length(latest_raw_hash) = 64),
  attribution_label TEXT NOT NULL,
  attribution_url TEXT NOT NULL,
  attribution_required INTEGER NOT NULL CHECK (attribution_required IN (0, 1)),
  followed_link_required INTEGER NOT NULL CHECK (followed_link_required IN (0, 1)),
  PRIMARY KEY (source_key, partition, external_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX job_source_links_job_idx ON job_source_links(job_id, status, last_seen_at DESC);
