CREATE TABLE application_agent_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE
    CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(id, owner_id, draft_id),
  FOREIGN KEY(draft_id, owner_id)
    REFERENCES application_drafts(id, owner_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX application_agent_sessions_owner_draft_idx
  ON application_agent_sessions(owner_id, draft_id, expires_at DESC, id);

CREATE INDEX application_agent_sessions_active_token_idx
  ON application_agent_sessions(token_hash, owner_id, draft_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE application_data_grant_bindings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  payload_hash TEXT NOT NULL
    CHECK(length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  categories_json TEXT NOT NULL CHECK(json_valid(categories_json)),
  field_keys_json TEXT NOT NULL CHECK(json_valid(field_keys_json)),
  document_ids_json TEXT NOT NULL CHECK(json_valid(document_ids_json)),
  notice_version TEXT NOT NULL,
  legal_basis TEXT NOT NULL
    CHECK(legal_basis IN ('consent','contract','legitimate_interest','legal_obligation','user_instruction')),
  status TEXT NOT NULL CHECK(status IN ('requested','active','withdrawn')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  withdrawn_at TEXT,
  UNIQUE(owner_id, draft_id, recipient_id, purpose, payload_hash),
  FOREIGN KEY(draft_id, owner_id)
    REFERENCES application_drafts(id, owner_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX application_data_grant_bindings_current_idx
  ON application_data_grant_bindings(
    owner_id,
    draft_id,
    recipient_id,
    purpose,
    payload_hash,
    status,
    expires_at
  );

CREATE TRIGGER application_delegation_records_bind_agent_session
BEFORE INSERT ON application_delegation_records
WHEN NOT EXISTS (
  SELECT 1
  FROM application_agent_sessions
  WHERE id = NEW.agent_id
    AND owner_id = NEW.owner_id
    AND draft_id = NEW.resource_id
)
BEGIN
  SELECT RAISE(ABORT, 'delegation session must bind the same owner and draft');
END;
