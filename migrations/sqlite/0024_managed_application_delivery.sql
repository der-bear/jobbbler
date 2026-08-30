CREATE TABLE managed_application_deliveries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE RESTRICT,
  review_id TEXT NOT NULL REFERENCES application_review_records(id) ON DELETE RESTRICT,
  confirmation_id TEXT NOT NULL REFERENCES application_confirmation_records(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider = 'jobbbler_demo'),
  provider_reference_id TEXT NOT NULL UNIQUE,
  recipient_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  fields_json TEXT NOT NULL CHECK(json_valid(fields_json)),
  status TEXT NOT NULL CHECK(status = 'acknowledged'),
  acknowledged_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(owner_id, draft_id, idempotency_key),
  UNIQUE(confirmation_id)
) STRICT;

CREATE INDEX managed_application_deliveries_draft_idx
  ON managed_application_deliveries(owner_id, draft_id, acknowledged_at DESC, id DESC);

CREATE TRIGGER managed_application_deliveries_bind_demo_job
BEFORE INSERT ON managed_application_deliveries
WHEN NOT EXISTS (
  SELECT 1
  FROM application_drafts AS draft
  JOIN jobs AS job ON job.id = draft.job_id
  JOIN application_review_records AS review
    ON review.id = NEW.review_id
    AND review.owner_id = NEW.owner_id
    AND review.draft_id = NEW.draft_id
    AND review.payload_hash = NEW.payload_hash
    AND review.status = 'active'
  JOIN application_confirmation_records AS confirmation
    ON confirmation.id = NEW.confirmation_id
    AND confirmation.owner_id = NEW.owner_id
    AND confirmation.draft_id = NEW.draft_id
    AND confirmation.review_id = NEW.review_id
    AND confirmation.payload_hash = NEW.payload_hash
    AND confirmation.status = 'active'
  WHERE draft.id = NEW.draft_id
    AND draft.owner_id = NEW.owner_id
    AND draft.state = 'reviewed'
    AND job.apply_mode = 'internal'
    AND job.source_key = 'jobbbler_demo'
    AND job.source_url IS NULL
    AND job.organization_id = NEW.recipient_id
)
BEGIN
  SELECT RAISE(ABORT, 'managed delivery requires a current first-party demo application');
END;

ALTER TABLE application_submission_receipts
  ADD COLUMN submission_json TEXT CHECK(submission_json IS NULL OR json_valid(submission_json));

CREATE TRIGGER application_receipts_require_managed_delivery
BEFORE INSERT ON application_submission_receipts
WHEN NEW.status = 'submitted' AND (
  NEW.submission_json IS NULL OR
  NOT EXISTS (
    SELECT 1
    FROM managed_application_deliveries AS delivery
    WHERE delivery.id = json_extract(NEW.submission_json, '$.managedDeliveryId')
      AND delivery.owner_id = NEW.owner_id
      AND delivery.draft_id = NEW.draft_id
      AND delivery.review_id = NEW.review_id
      AND delivery.confirmation_id = NEW.confirmation_id
      AND delivery.idempotency_key = NEW.idempotency_key
      AND delivery.provider = json_extract(NEW.submission_json, '$.provider')
      AND delivery.provider_reference_id = json_extract(NEW.submission_json, '$.providerReferenceId')
      AND delivery.recipient_id = json_extract(NEW.submission_json, '$.recipientId')
      AND delivery.recipient_name = json_extract(NEW.submission_json, '$.recipientName')
      AND delivery.acknowledged_at = json_extract(NEW.submission_json, '$.submittedAt')
      AND delivery.fields_json = json_extract(NEW.submission_json, '$.fields')
      AND delivery.status = 'acknowledged'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'submitted receipt requires acknowledged managed delivery');
END;
