CREATE TABLE jobbbler.owner_activity_events (
  sequence bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE CHECK (length(id) BETWEEN 38 AND 68),
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 38 AND 68),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  kind text NOT NULL CHECK (
    kind IN ('tool', 'authorization', 'consent', 'application', 'saved_search', 'schedule', 'source_health')
  ),
  activity_key text NOT NULL CHECK (length(activity_key) BETWEEN 1 AND 30),
  status text NOT NULL CHECK (
    status IN ('running', 'completed', 'requires_user_action', 'failed', 'cancelled')
  ),
  safe_summary text NOT NULL CHECK (length(safe_summary) BETWEEN 1 AND 240),
  correlation_id text NOT NULL CHECK (length(correlation_id) BETWEEN 38 AND 68),
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'agent', 'service')),
  aggregate_type text NOT NULL CHECK (
    aggregate_type IN ('application_draft', 'saved_search', 'schedule', 'source', 'system')
  ),
  aggregate_version integer NOT NULL CHECK (aggregate_version >= 0),
  occurred_at timestamptz NOT NULL,
  effects jsonb NOT NULL CHECK (jsonb_typeof(effects) = 'array')
);

CREATE INDEX owner_activity_events_owner_sequence_idx
  ON jobbbler.owner_activity_events(owner_id, sequence);

ALTER TABLE jobbbler.owner_activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_activity_events_owner_only
  ON jobbbler.owner_activity_events FOR SELECT TO authenticated
  USING (owner_id = jobbbler.current_owner_id());

REVOKE ALL ON jobbbler.owner_activity_events FROM anon, authenticated;
GRANT SELECT ON jobbbler.owner_activity_events TO authenticated;
