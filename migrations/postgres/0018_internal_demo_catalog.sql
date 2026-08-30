-- Keep an already-imported demo catalog aligned with the first-party product
-- contract. The entity-record trigger refreshes the public search projection.
UPDATE jobbbler.entity_records
SET
  body = jsonb_set(
    jsonb_set(body, '{applyMode}', '"internal"'::jsonb, true),
    '{status}',
    '"open"'::jsonb,
    true
  ),
  updated_at = now()
WHERE kind = 'job' AND body #>> '{source,key}' = 'jobbbler_demo';
