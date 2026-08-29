CREATE TABLE alert_evaluations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  saved_search_id TEXT NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  catalog_updated_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX alert_evaluations_saved_search_idx
  ON alert_evaluations(saved_search_id, created_at DESC, id DESC);

CREATE TABLE alert_evaluation_baselines (
  evaluation_id TEXT NOT NULL REFERENCES alert_evaluations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) > 0),
  PRIMARY KEY (evaluation_id, job_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE alert_changes (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES alert_evaluations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('new', 'updated', 'closed', 'no_longer_matching')),
  created_at TEXT NOT NULL,
  UNIQUE (evaluation_id, job_id, kind)
) STRICT;

CREATE INDEX alert_changes_evaluation_idx
  ON alert_changes(evaluation_id, created_at, id);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES alert_evaluations(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'accepted', 'failed', 'dead', 'cancelled')),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  provider_ref TEXT,
  error_code TEXT,
  accepted_at TEXT,
  last_attempt_at TEXT,
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (schedule_id, evaluation_id, endpoint_id, content_hash),
  CHECK ((status = 'accepted' AND accepted_at IS NOT NULL) OR (status <> 'accepted' AND accepted_at IS NULL))
) STRICT;

CREATE INDEX notification_deliveries_evaluation_idx
  ON notification_deliveries(evaluation_id, status, created_at, id);

CREATE TRIGGER alert_evaluations_no_update
BEFORE UPDATE ON alert_evaluations
BEGIN
  SELECT RAISE(ABORT, 'alert evaluations are immutable');
END;

CREATE TRIGGER alert_evaluation_baselines_no_update
BEFORE UPDATE ON alert_evaluation_baselines
BEGIN
  SELECT RAISE(ABORT, 'alert evaluation baselines are immutable');
END;

CREATE TRIGGER alert_changes_no_update
BEFORE UPDATE ON alert_changes
BEGIN
  SELECT RAISE(ABORT, 'alert changes are immutable');
END;
