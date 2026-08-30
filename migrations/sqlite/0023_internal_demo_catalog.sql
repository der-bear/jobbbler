-- Demo openings are first-party Jobbbler roles. Earlier fixture revisions
-- marked some of them external, but changing application mode through normal
-- ingestion is intentionally forbidden. Reconcile only the synthetic source
-- before the authoritative fixture is seeded again.
UPDATE jobs
SET apply_mode = 'internal', status = 'open'
WHERE source_key = 'jobbbler_demo';
