ALTER TABLE managed_application_deliveries
  ADD COLUMN role_json TEXT CHECK(role_json IS NULL OR json_valid(role_json));

UPDATE managed_application_deliveries
SET role_json = (
  SELECT json_object('id', job.id, 'title', job.title)
  FROM application_drafts AS draft
  JOIN jobs AS job ON job.id = draft.job_id
  WHERE draft.id = managed_application_deliveries.draft_id
    AND draft.owner_id = managed_application_deliveries.owner_id
)
WHERE role_json IS NULL;

UPDATE application_submission_receipts
SET submission_json = json_set(
  submission_json,
  '$.role',
  json((
    SELECT delivery.role_json
    FROM managed_application_deliveries AS delivery
    WHERE delivery.id = json_extract(application_submission_receipts.submission_json, '$.managedDeliveryId')
      AND delivery.owner_id = application_submission_receipts.owner_id
  ))
)
WHERE status = 'submitted'
  AND submission_json IS NOT NULL
  AND json_type(submission_json, '$.role') IS NULL
  AND EXISTS (
    SELECT 1
    FROM managed_application_deliveries AS delivery
    WHERE delivery.id = json_extract(application_submission_receipts.submission_json, '$.managedDeliveryId')
      AND delivery.owner_id = application_submission_receipts.owner_id
      AND delivery.role_json IS NOT NULL
  );

CREATE TRIGGER managed_application_deliveries_require_role_snapshot
BEFORE INSERT ON managed_application_deliveries
WHEN NEW.role_json IS NULL OR
  json_type(NEW.role_json) <> 'object' OR
  NOT EXISTS (
    SELECT 1
    FROM application_drafts AS draft
    JOIN jobs AS job ON job.id = draft.job_id
    WHERE draft.id = NEW.draft_id
      AND draft.owner_id = NEW.owner_id
      AND job.id = json_extract(NEW.role_json, '$.id')
      AND job.title = json_extract(NEW.role_json, '$.title')
  )
BEGIN
  SELECT RAISE(ABORT, 'managed delivery requires the transaction-bound role snapshot');
END;

CREATE TRIGGER application_receipts_require_role_snapshot
BEFORE INSERT ON application_submission_receipts
WHEN NEW.status = 'submitted' AND NEW.submission_json IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM managed_application_deliveries AS delivery
  WHERE delivery.id = json_extract(NEW.submission_json, '$.managedDeliveryId')
    AND delivery.owner_id = NEW.owner_id
    AND json_type(NEW.submission_json, '$.role') = 'object'
    AND json_extract(delivery.role_json, '$.id') = json_extract(NEW.submission_json, '$.role.id')
    AND json_extract(delivery.role_json, '$.title') = json_extract(NEW.submission_json, '$.role.title')
)
BEGIN
  SELECT RAISE(ABORT, 'submitted receipt requires the managed delivery role snapshot');
END;
