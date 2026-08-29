# Agent Authorization and Data Consent

**Status:** Accepted architecture; exact WebMCP client capabilities must be revalidated immediately before implementation.

## Decision

Jobbbler uses progressive human identity and explicit, revocable agent delegation. It does not give a model a reusable application key. A model-visible bearer secret could be copied into conversation history, logs, another tool call, or another origin and cannot reliably prove which agent is presenting it.

Instead, WebMCP returns non-secret resource references. Authority stays server-side and is reached through the current secure human session plus a narrowly scoped delegation record. A compatible external agent client may later use a standard OAuth sender-constrained token profile, but the browser experience will not claim cryptographic agent identity unless the client API actually provides it.

## Four independent controls

| Control                  | Proves or authorizes                                               | Lifetime                                     | Never implies                                         |
| ------------------------ | ------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------- |
| Human owner session      | Which person owns private resources                                | Session; recoverable after verification      | Agent authority or submission approval                |
| Agent delegation         | Named operations by one agent session on one resource              | Short, explicit expiry; revocable            | New data purposes or final submission                 |
| Data authorization grant | Processing or disclosure of named data for a recipient and purpose | Purpose-bound; withdrawable where applicable | General resource access or submit authority           |
| Action confirmation      | One immutable reviewed payload                                     | Minutes; single use                          | Permission for a changed payload or another recipient |

Authentication, authorization, and consent are deliberately not represented by one token.

## Progressive identity without a traditional login wall

1. Public search and comparison require no identity.
2. The first private action creates an ephemeral owner session. In production this can use a Supabase anonymous user; locally it uses the equivalent opaque session and owner record.
3. The session may own an ephemeral application draft. Losing browser storage or the session ends recoverability; the UI states this plainly.
4. Saving private work across devices, uploading documents, or submitting an application requires a verified channel. Email OTP or a carefully exchanged one-time magic link upgrades the same owner instead of creating a second profile.
5. Passkeys are an optional phishing-resistant account upgrade and step-up mechanism. A passkey never replaces action-specific review and confirmation.
6. Anonymous-to-verified merge is transactional, idempotent, conflict-aware, audited, and revokes outstanding guest-management capabilities.

Supabase documents anonymous users as authenticated principals that can later link an identity, while warning that they cannot recover the account after sign-out or cleared browser data and must be distinguished in RLS policies: [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous).

## Agent authorization flow

1. A WebMCP command reaches the Policy Enforcement Point in the BFF.
2. The backend evaluates human owner, agent session, resource, action, state, expiry, and risk.
3. If authority is absent but requestable, the response is a structured denial with a non-secret approval request ID and `requires_user_action` status.
4. Jobbbler opens a trusted first-party approval surface showing the agent session label, resource, operations, purpose, duration, and affected data classes.
5. A direct human action approves or rejects the request. The agent cannot self-approve by supplying more parameters.
6. Approval creates a server-side delegation; it does not return a reusable secret through WebMCP.
7. The original command is not automatically replayed. The agent retries, and the backend performs a fresh authorization evaluation.
8. Revocation, expiry, resource version changes, owner changes, or risk-policy changes take effect at the next evaluation.

This follows the useful AuthZEN requestable-denial principle: approval workflow creates new authority, but the enforcement point still re-evaluates before allowing an operation.

### Delegation record

At minimum it stores:

- delegation ID and version;
- human owner ID;
- opaque browser agent session ID or verified external client ID;
- resource type and ID;
- exact operations;
- purpose and request correlation;
- issued, expiry, revoked, and last-used timestamps;
- approver action and approval-surface version;
- risk flags and safe audit metadata.

The browser agent session ID is a scoping handle, not a claim that Jobbbler has authenticated a particular model vendor. If a future client supplies a verifiable identity, it is stored separately as `verified_client_id`.

## Data authorization and consent

The agent may request a data operation, but the Jobbbler surface collects the authoritative human decision. A statement made only in model conversation is not recorded as platform consent unless a future standard provides a signed, verifiable user instruction that preserves notice and intent.

Before optional AI processing or disclosure to an employer, the UI shows:

- controller or recipient identity;
- specific purpose;
- exact field and document categories;
- processing operations, including whether an AI provider is involved;
- retention and withdrawal or deletion consequences;
- privacy-notice and consent-copy versions;
- whether refusing is compatible with the core service;
- a clear unselected affirmative control.

The grant stores owner, agent session, recipient, purpose, fields, documents, payload boundary, policy versions, legal-basis classification, affirmative action, timestamps, expiry, withdrawal, and correlation IDs. A new recipient, purpose, field category, document, or materially changed payload requires a new or amended grant.

Consent is not used as a marketing label for every instruction. Where processing is necessary to provide a user-requested application service, the legal basis may differ; the product records that basis separately and will not claim jurisdiction-wide legal compliance without review. Where consent is the basis, it must be freely given, specific, informed, unambiguous, affirmative, and reversible, consistent with [EDPB Guidelines 05/2020](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_202005_consent_en.pdf).

## Submission invariant

An internal submission is allowed only when all statements are true in one transaction:

- the authenticated owner owns the draft and meets the required verification level;
- the agent delegation, if the command is agent-initiated, permits `submit_application` for this draft;
- the immutable review version equals the current draft version;
- recipient, requirement, document, declaration, and payload hashes match;
- every required data grant is active and covers the exact disclosure;
- the confirmation is unused, unexpired, and bound to this owner and review;
- the idempotency key is valid and either new or mapped to the same response;
- no revoke or material edit won the race before the adapter claim.

Submission token consumption, state transition, audit record, outbox event, and idempotency response commit atomically. External jobs produce only a prepared packet and `handed_off` receipt.

## Token classes

Verification challenge, owner session, guest-management capability, agent delegation reference, and application confirmation are separate classes with explicit audience, scope, storage, TTL, replay, revocation, and logging rules. Raw values are random, stored hashed when lookup permits, never placed in analytics, and immediately exchanged out of URLs where a one-time link is unavoidable.

OAuth security guidance recommends sender-constrained and audience-restricted access tokens to limit stolen-token misuse: [OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.10). DPoP is an application-layer proof-of-possession mechanism suitable for compatible public clients: [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html). Those standards inform external-agent support; they are not retrofitted into WebMCP without client support.

## Privacy and security invariants

- Tool schemas ask only for data necessary to perform the named operation; they do not harvest personalization context.
- Sensitive values and documents are entered or selected on the first-party surface, not echoed through tool outputs.
- Audit events identify decisions and hashes but redact secrets and high-risk personal content.
- Access uses deny-by-default policy, resource ownership, and aggregate version checks.
- Every grant and delegation has an accessible revoke surface and deterministic expiry.
- Consent withdrawal stops future consent-based processing; it does not falsify a lawful historical submission receipt.
- Deletion and retention rules cover derived AI artifacts, audit minimization, and downstream-recipient limits.
- Rate limits, CAPTCHA/Turnstile for anonymous creation, CSRF/origin checks, and RLS protect the progressive identity path.

## Required evidence

- Unit tests for cross-owner, cross-draft, cross-action, expired, revoked, replayed, and payload-change failures.
- Integration tests proving the agent cannot self-approve and a successful approval still requires re-evaluation.
- Browser tests for clear grant copy, keyboard/focus behavior, rejection, withdrawal, revoke, and expired confirmation.
- RLS tests that distinguish anonymous and verified owners.
- Redaction tests ensuring no raw token, application answer, or document enters tool output, realtime payload, or log.
- A concise public threat model and an end-to-end demo of request, approval, action, revoke, and denied retry.
