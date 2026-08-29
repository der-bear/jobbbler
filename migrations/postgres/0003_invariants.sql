CREATE UNIQUE INDEX entity_records_schedule_owner_search_unique
  ON jobbbler.entity_records(owner_id, (body->>'savedSearchId'))
  WHERE kind = 'schedule';
CREATE UNIQUE INDEX entity_records_delivery_content_unique
  ON jobbbler.entity_records(
    (body->>'scheduleId'), (body->>'evaluationId'), (body->>'endpointId'), (body->>'contentHash')
  ) WHERE kind = 'alert_delivery';
CREATE UNIQUE INDEX entity_records_session_token_unique
  ON jobbbler.entity_records((body->>'tokenHash')) WHERE kind = 'owner_session';
CREATE UNIQUE INDEX entity_records_endpoint_address_unique
  ON jobbbler.entity_records(owner_id, (body->>'addressHash')) WHERE kind = 'verification_endpoint';
CREATE INDEX entity_records_work_claim_idx ON jobbbler.entity_records(
  kind, (body->>'status'), (body->>'availableAt'), (body->>'leaseExpiresAt')
) WHERE kind = 'work_item';
