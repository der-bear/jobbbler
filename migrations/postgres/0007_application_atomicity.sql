CREATE INDEX entity_records_application_review_latest_idx
  ON jobbbler.entity_records(owner_id, (body->>'draftId'), created_at DESC, id DESC)
  WHERE kind = 'application_review';

CREATE INDEX entity_records_application_receipt_latest_idx
  ON jobbbler.entity_records(owner_id, (body->>'draftId'), created_at DESC, id DESC)
  WHERE kind = 'application_receipt';

CREATE UNIQUE INDEX entity_records_application_receipt_idempotency_unique
  ON jobbbler.entity_records(owner_id, (body->>'draftId'), (body->>'idempotencyKey'))
  WHERE kind = 'application_receipt';
