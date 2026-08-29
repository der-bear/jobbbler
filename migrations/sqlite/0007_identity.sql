CREATE TABLE owner_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX owner_sessions_active_token_idx
  ON owner_sessions(token_hash, expires_at)
  WHERE status = 'active';

CREATE TABLE verification_endpoints (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind = 'email'),
  address_hash TEXT NOT NULL,
  address_ciphertext TEXT NOT NULL,
  masked_address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'revoked')),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, kind, address_hash)
) STRICT;

CREATE INDEX verification_endpoints_owner_idx
  ON verification_endpoints(owner_id, status, updated_at DESC, id);

CREATE TABLE verification_challenges (
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

CREATE INDEX verification_challenges_owner_status_idx
  ON verification_challenges(owner_id, status, expires_at, id);

CREATE INDEX verification_challenges_endpoint_idx
  ON verification_challenges(endpoint_id, status, created_at DESC, id);
