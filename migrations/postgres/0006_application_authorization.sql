-- Authorization records remain portable JSON, but their hot authorization
-- paths need explicit indexes. Only one-way token digests are persisted.
CREATE UNIQUE INDEX entity_records_agent_session_token_unique
  ON jobbbler.entity_records((body->>'tokenHash'))
  WHERE kind = 'agent_session';

CREATE INDEX entity_records_agent_session_live_lookup_idx
  ON jobbbler.entity_records(
    owner_id,
    (body->>'draftId'),
    (body->>'tokenHash'),
    (body->>'expiresAt')
  )
  WHERE kind = 'agent_session' AND body->>'revokedAt' IS NULL;

CREATE INDEX entity_records_delegation_active_match_idx
  ON jobbbler.entity_records(
    owner_id,
    (body->>'agentSessionId'),
    (body->>'resourceType'),
    (body->>'resourceId'),
    (body->>'expiresAt') DESC
  )
  WHERE kind = 'delegation' AND body->>'status' = 'active';

CREATE INDEX entity_records_rich_data_grant_current_idx
  ON jobbbler.entity_records(
    owner_id,
    (body->>'draftId'),
    (body->>'recipientId'),
    (body->>'purpose'),
    (body->>'payloadHash'),
    (body->>'noticeVersion'),
    (body->>'legalBasis'),
    (body->>'expiresAt') DESC
  )
  WHERE kind = 'rich_data_grant' AND body->>'status' = 'active';
