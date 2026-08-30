ALTER TABLE application_delegation_records
  ADD COLUMN decision_channel TEXT
  CHECK (decision_channel IN ('first_party_ui', 'agent_client'));

ALTER TABLE application_delegation_records
  ADD COLUMN decision_request_id TEXT;

ALTER TABLE application_delegation_records
  ADD COLUMN decision_action TEXT
  CHECK (decision_action IN ('approved', 'declined', 'revoked'));

ALTER TABLE application_delegation_records
  ADD COLUMN decision_evidence_version TEXT
  CHECK (decision_evidence_version = 'agent-interaction-v1');
