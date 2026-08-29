CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('ephemeral', 'guest', 'user', 'service')),
  verified INTEGER NOT NULL CHECK (verified IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES owners(id) ON DELETE CASCADE,
  client_label TEXT NOT NULL,
  verified_identity TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX agent_sessions_owner_idx ON agent_sessions(owner_id, created_at DESC);

CREATE TABLE agent_delegations (
  id TEXT PRIMARY KEY,
  agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL,
  operations_json TEXT NOT NULL CHECK (json_valid(operations_json)),
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested', 'approved', 'denied', 'expired', 'revoked')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX agent_delegations_session_idx
  ON agent_delegations(agent_session_id, status, expires_at);

CREATE TABLE data_grants (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  categories_json TEXT NOT NULL CHECK (json_valid(categories_json)),
  field_keys_json TEXT NOT NULL CHECK (json_valid(field_keys_json)),
  document_ids_json TEXT NOT NULL CHECK (json_valid(document_ids_json)),
  payload_hash TEXT NOT NULL,
  notice_version TEXT NOT NULL,
  legal_basis TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested', 'granted', 'denied', 'withdrawn', 'expired')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX data_grants_draft_idx ON data_grants(draft_id, status, created_at DESC);

CREATE TABLE audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent', 'system', 'service')),
  actor_id TEXT,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  safe_metadata_json TEXT NOT NULL CHECK (json_valid(safe_metadata_json)),
  occurred_at TEXT NOT NULL
) STRICT;

CREATE INDEX audit_events_aggregate_idx
  ON audit_events(aggregate_type, aggregate_id, occurred_at, sequence);

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'dead')),
  available_at TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX outbox_events_due_idx ON outbox_events(status, available_at, created_at);

CREATE TABLE work_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'dead')),
  available_at TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX work_items_due_idx ON work_items(status, available_at, lease_expires_at);

CREATE TABLE idempotency_records (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  response_body_json TEXT NOT NULL CHECK (json_valid(response_body_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
) WITHOUT ROWID, STRICT;

CREATE INDEX idempotency_expiry_idx ON idempotency_records(expires_at);
