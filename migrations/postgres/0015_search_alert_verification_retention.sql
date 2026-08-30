CREATE INDEX entity_records_verification_challenge_purpose_expiry_idx
  ON jobbbler.entity_records(
    (COALESCE(body->>'purpose', 'owner_email_verification')),
    (body->>'expiresAt'),
    id
  )
  WHERE kind = 'verification_challenge';
