CREATE TABLE application_drafts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('draft', 'valid', 'reviewed', 'awaiting_confirmation', 'submitting', 'submitted', 'handed_off', 'withdrawn', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 0),
  answers_json TEXT NOT NULL CHECK (json_valid(answers_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, owner_id)
) STRICT;

CREATE INDEX application_drafts_owner_idx ON application_drafts(owner_id, updated_at DESC, id);
CREATE INDEX application_drafts_job_idx ON application_drafts(job_id, state, updated_at DESC);

CREATE TABLE application_reviews (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE CASCADE,
  draft_version INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  findings_json TEXT NOT NULL CHECK (json_valid(findings_json)),
  created_at TEXT NOT NULL,
  UNIQUE (draft_id, draft_version, payload_hash),
  UNIQUE (id, draft_id),
  UNIQUE (id, draft_id, payload_hash)
) STRICT;

CREATE TABLE action_confirmations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE CASCADE,
  review_id TEXT NOT NULL REFERENCES application_reviews(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested', 'confirmed', 'declined', 'expired', 'consumed')),
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, draft_id, review_id),
  FOREIGN KEY (draft_id, owner_id)
    REFERENCES application_drafts(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (review_id, draft_id, payload_hash)
    REFERENCES application_reviews(id, draft_id, payload_hash) ON DELETE CASCADE
) STRICT;

CREATE INDEX action_confirmations_draft_idx
  ON action_confirmations(draft_id, status, expires_at);

CREATE TABLE application_submissions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE RESTRICT,
  review_id TEXT NOT NULL REFERENCES application_reviews(id) ON DELETE RESTRICT,
  confirmation_id TEXT NOT NULL REFERENCES action_confirmations(id) ON DELETE RESTRICT,
  idempotency_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitting', 'submitted', 'handed_off', 'failed')),
  provider_receipt TEXT,
  safe_result_json TEXT NOT NULL CHECK (json_valid(safe_result_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (idempotency_scope, idempotency_key),
  UNIQUE (confirmation_id),
  FOREIGN KEY (review_id, draft_id)
    REFERENCES application_reviews(id, draft_id) ON DELETE RESTRICT,
  FOREIGN KEY (confirmation_id, draft_id, review_id)
    REFERENCES action_confirmations(id, draft_id, review_id) ON DELETE RESTRICT
) STRICT;
