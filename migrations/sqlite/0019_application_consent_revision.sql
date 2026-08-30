ALTER TABLE application_drafts
  ADD COLUMN consent_revision INTEGER NOT NULL DEFAULT 0
  CHECK (consent_revision >= 0);
