CREATE TABLE saved_searches (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  criteria_json TEXT NOT NULL CHECK (json_valid(criteria_json)),
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX saved_searches_owner_idx ON saved_searches(owner_id, updated_at DESC, id);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  saved_search_id TEXT NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  recurrence_json TEXT NOT NULL CHECK (json_valid(recurrence_json)),
  delivery_channel TEXT NOT NULL CHECK (delivery_channel = 'email'),
  delivery_endpoint_id TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  next_run_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX schedules_due_idx ON schedules(enabled, next_run_at, id);
CREATE INDEX schedules_owner_idx ON schedules(owner_id, updated_at DESC, id);

CREATE TABLE search_runs (
  id TEXT PRIMARY KEY,
  saved_search_id TEXT REFERENCES saved_searches(id) ON DELETE SET NULL,
  criteria_json TEXT NOT NULL CHECK (json_valid(criteria_json)),
  result_job_ids_json TEXT NOT NULL CHECK (json_valid(result_job_ids_json)),
  source_status_json TEXT NOT NULL CHECK (json_valid(source_status_json)),
  catalog_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX search_runs_saved_search_idx ON search_runs(saved_search_id, created_at DESC);

CREATE TABLE search_deltas (
  id TEXT PRIMARY KEY,
  search_run_id TEXT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('new', 'updated', 'closed')),
  created_at TEXT NOT NULL,
  UNIQUE (search_run_id, job_id, kind)
) STRICT;
