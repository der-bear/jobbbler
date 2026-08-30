CREATE UNIQUE INDEX entity_records_managed_delivery_provider_reference_unique
  ON jobbbler.entity_records((body->>'provider'), (body->>'providerReferenceId'))
  WHERE kind = 'managed_application_delivery';

CREATE UNIQUE INDEX entity_records_managed_delivery_idempotency_unique
  ON jobbbler.entity_records(owner_id, (body->>'draftId'), (body->>'idempotencyKey'))
  WHERE kind = 'managed_application_delivery';

CREATE UNIQUE INDEX entity_records_managed_delivery_confirmation_unique
  ON jobbbler.entity_records((body->>'confirmationId'))
  WHERE kind = 'managed_application_delivery';

CREATE UNIQUE INDEX entity_records_application_receipt_delivery_unique
  ON jobbbler.entity_records((body #>> '{submission,managedDeliveryId}'))
  WHERE kind = 'application_receipt'
    AND body->>'status' = 'submitted'
    AND body #>> '{submission,managedDeliveryId}' IS NOT NULL;

CREATE UNIQUE INDEX entity_records_application_receipt_confirmation_unique
  ON jobbbler.entity_records((body->>'confirmationId'))
  WHERE kind = 'application_receipt';

CREATE INDEX entity_records_managed_delivery_draft_latest_idx
  ON jobbbler.entity_records(owner_id, (body->>'draftId'), (body->>'acknowledgedAt') DESC, id DESC)
  WHERE kind = 'managed_application_delivery';

CREATE OR REPLACE FUNCTION jobbbler.enforce_application_receipt_managed_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.kind <> 'application_receipt' OR NEW.body->>'status' <> 'submitted' THEN
    RETURN NEW;
  END IF;

  -- Receipts created before the managed-delivery snapshot existed remain importable.
  -- They render as unavailable receipts and cannot make a success claim in the app.
  IF NOT (NEW.body ? 'submission') OR NEW.body->'submission' = 'null'::jsonb THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.body->'submission') <> 'object' OR NOT EXISTS (
    SELECT 1
    FROM jobbbler.entity_records AS delivery
    WHERE delivery.kind = 'managed_application_delivery'
      AND delivery.id = NEW.body #>> '{submission,managedDeliveryId}'
      AND delivery.owner_id IS NOT DISTINCT FROM NEW.owner_id
      AND delivery.body->>'draftId' = NEW.body->>'draftId'
      AND delivery.body->>'reviewId' = NEW.body->>'reviewId'
      AND delivery.body->>'confirmationId' = NEW.body->>'confirmationId'
      AND delivery.body->>'idempotencyKey' = NEW.body->>'idempotencyKey'
      AND delivery.body->>'provider' = 'jobbbler_demo'
      AND delivery.body->>'provider' = NEW.body #>> '{submission,provider}'
      AND delivery.body->>'providerReferenceId' = NEW.body #>> '{submission,providerReferenceId}'
      AND delivery.body->>'recipientId' = NEW.body #>> '{submission,recipientId}'
      AND delivery.body->>'recipientName' = NEW.body #>> '{submission,recipientName}'
      AND delivery.body->>'acknowledgedAt' = NEW.body #>> '{submission,submittedAt}'
      AND delivery.body->'fields' = NEW.body #> '{submission,fields}'
      AND delivery.body->>'status' = 'acknowledged'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'submitted receipt requires an exact acknowledged managed delivery';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER application_receipt_requires_managed_delivery
AFTER INSERT OR UPDATE ON jobbbler.entity_records
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION jobbbler.enforce_application_receipt_managed_delivery();
