ALTER TABLE application_data_grant_bindings
  ADD COLUMN withdrawal_channel TEXT
  CHECK (withdrawal_channel IN ('first_party_ui', 'agent_client'));

ALTER TABLE application_data_grant_bindings
  ADD COLUMN withdrawal_request_id TEXT;

ALTER TABLE application_data_grant_bindings
  ADD COLUMN withdrawal_action TEXT
  CHECK (withdrawal_action = 'withdrawn');

ALTER TABLE application_data_grant_bindings
  ADD COLUMN withdrawal_evidence_version TEXT
  CHECK (withdrawal_evidence_version = 'agent-interaction-v1');
