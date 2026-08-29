CREATE TABLE owner_activity_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  kind TEXT NOT NULL CHECK (
    kind IN ('tool', 'authorization', 'consent', 'application', 'saved_search', 'schedule', 'source_health')
  ),
  activity_key TEXT NOT NULL CHECK (length(activity_key) BETWEEN 1 AND 30),
  status TEXT NOT NULL CHECK (
    status IN ('running', 'completed', 'requires_user_action', 'failed', 'cancelled')
  ),
  safe_summary TEXT NOT NULL CHECK (length(safe_summary) BETWEEN 1 AND 240),
  correlation_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent', 'service')),
  aggregate_type TEXT NOT NULL CHECK (
    aggregate_type IN ('application_draft', 'saved_search', 'schedule', 'source', 'system')
  ),
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version >= 0),
  occurred_at TEXT NOT NULL,
  effects_json TEXT NOT NULL CHECK (json_valid(effects_json))
) STRICT;

CREATE INDEX owner_activity_events_owner_sequence_idx
  ON owner_activity_events(owner_id, sequence);
