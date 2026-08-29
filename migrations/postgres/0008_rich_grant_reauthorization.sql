CREATE UNIQUE INDEX entity_records_rich_data_grant_live_scope_unique
  ON jobbbler.entity_records(
    owner_id,
    (body->>'draftId'),
    (body->>'recipientId'),
    (body->>'purpose'),
    (body->>'payloadHash'),
    (body->'categories'),
    (body->'fieldKeys'),
    (body->'documentIds'),
    (body->>'noticeVersion'),
    (body->>'legalBasis')
  ) WHERE kind = 'rich_data_grant' AND body->>'status' IN ('requested', 'active');
