ALTER TABLE application_data_grant_bindings
  ADD COLUMN approval_channel TEXT
  CHECK (approval_channel IN ('first_party_ui', 'agent_client'));

ALTER TABLE application_data_grant_bindings
  ADD COLUMN approval_request_id TEXT;

ALTER TABLE application_data_grant_bindings
  ADD COLUMN affirmative_action TEXT
  CHECK (affirmative_action = 'confirmed');

ALTER TABLE application_data_grant_bindings
  ADD COLUMN approval_evidence_version TEXT
  CHECK (approval_evidence_version = 'agent-interaction-v1');
