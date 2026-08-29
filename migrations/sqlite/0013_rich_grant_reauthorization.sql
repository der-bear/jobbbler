CREATE TABLE application_data_grant_bindings_reauthorized (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  categories_json TEXT NOT NULL CHECK(json_valid(categories_json)),
  field_keys_json TEXT NOT NULL CHECK(json_valid(field_keys_json)),
  document_ids_json TEXT NOT NULL CHECK(json_valid(document_ids_json)),
  notice_version TEXT NOT NULL,
  legal_basis TEXT NOT NULL CHECK(legal_basis IN ('consent','contract','legitimate_interest','legal_obligation','user_instruction')),
  status TEXT NOT NULL CHECK(status IN ('requested','active','withdrawn')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  withdrawn_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(draft_id, owner_id) REFERENCES application_drafts(id, owner_id) ON DELETE CASCADE
) STRICT;

INSERT INTO application_data_grant_bindings_reauthorized
SELECT id, owner_id, draft_id, recipient_id, purpose, payload_hash, categories_json,
       field_keys_json, document_ids_json, notice_version, legal_basis, status,
       expires_at, created_at, approved_at, withdrawn_at, version
FROM application_data_grant_bindings;

DROP TABLE application_data_grant_bindings;
ALTER TABLE application_data_grant_bindings_reauthorized RENAME TO application_data_grant_bindings;

CREATE UNIQUE INDEX application_data_grant_bindings_live_scope_unique
  ON application_data_grant_bindings(
    owner_id, draft_id, recipient_id, purpose, payload_hash, categories_json,
    field_keys_json, document_ids_json, notice_version, legal_basis
  ) WHERE status IN ('requested', 'active');

CREATE INDEX application_data_grant_bindings_current_idx
  ON application_data_grant_bindings(
    owner_id, draft_id, recipient_id, purpose, payload_hash, status, expires_at
  );
