CREATE TABLE owner_recovery_challenges (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL REFERENCES verification_endpoints(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'expired', 'locked')),
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL)
    OR (status <> 'consumed' AND consumed_at IS NULL)
  ),
  CHECK (attempts <= max_attempts)
) STRICT;

CREATE UNIQUE INDEX verification_endpoints_verified_address_unique
  ON verification_endpoints(address_hash)
  WHERE status = 'verified';

CREATE INDEX owner_recovery_challenges_owner_status_idx
  ON owner_recovery_challenges(owner_id, status, expires_at, id);

CREATE INDEX owner_recovery_challenges_endpoint_idx
  ON owner_recovery_challenges(endpoint_id, status, created_at DESC, id);

CREATE TABLE owner_deletion_intents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX owner_deletion_intents_owner_status_idx
  ON owner_deletion_intents(owner_id, status, expires_at, id);
