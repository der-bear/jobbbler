CREATE UNIQUE INDEX entity_records_verified_endpoint_address_unique
  ON jobbbler.entity_records((body->>'addressHash'))
  WHERE kind = 'verification_endpoint' AND body->>'status' = 'verified';

CREATE UNIQUE INDEX entity_records_owner_recovery_token_unique
  ON jobbbler.entity_records((body->>'tokenHash'))
  WHERE kind = 'owner_recovery_challenge';

CREATE INDEX entity_records_owner_recovery_live_idx
  ON jobbbler.entity_records(owner_id, (body->>'status'), (body->>'expiresAt'), id)
  WHERE kind = 'owner_recovery_challenge';

CREATE INDEX entity_records_owner_deletion_intent_live_idx
  ON jobbbler.entity_records(owner_id, (body->>'status'), (body->>'expiresAt'), id)
  WHERE kind = 'owner_deletion_intent';
