ALTER TABLE verification_challenges
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'owner_email_verification'
  CHECK (purpose IN ('owner_email_verification', 'search_alert_review'));

CREATE INDEX verification_challenges_purpose_expiry_idx
  ON verification_challenges(purpose, expires_at, id);
