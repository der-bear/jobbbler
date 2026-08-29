ALTER TABLE application_data_grant_bindings
  ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX application_review_records_latest_idx
  ON application_review_records(draft_id, owner_id, created_at DESC, id DESC);

CREATE INDEX application_submission_receipts_latest_idx
  ON application_submission_receipts(draft_id, owner_id, created_at DESC, id DESC);
