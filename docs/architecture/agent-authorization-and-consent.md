# Agent Authorization and Data Consent

**Status:** Release behavior is implemented and covered by domain, route, storage, and browser journey tests. Future upgrade points are labeled explicitly.

## Decision

Jobbbler uses progressive human identity and explicit, revocable agent delegation. It does not give a model a reusable application key. A model-visible bearer secret could be copied into conversation history, logs, another tool call, or another origin and cannot reliably prove which agent is presenting it.

Instead, WebMCP returns non-secret resource references. Authority stays server-side and is reached through the current secure human session plus a narrowly scoped delegation record. The imperative WebMCP API standardizes neither a native consent UI nor cryptographic proof that a tool decision came from a human, model, or agent vendor. A compatible external agent client may use its own interaction UI, show or observe the current tab or surface, or later use a standard OAuth sender-constrained token profile. The browser experience will not claim cryptographic identity unless the client API actually provides it.

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
2. The first private action creates an ephemeral owner plus an opaque HttpOnly session. The same contract runs on SQLite locally and PostgreSQL in production; it does not depend on a third-party login provider.
3. The session may own an application and saved searches. Losing the only session for an unverified owner ends recoverability; it does not invalidate work while that session remains available.
4. A verified email is optional durability, not an application-submission wall. Email OTP upgrades the same owner for passwordless recovery; a separately reviewed email alert also requires a verified destination. Searching, preparing, and submitting a Jobbbler-managed application do not require email verification.
5. Email verification upgrades the same owner transactionally and revokes prior sessions during recovery. The release does not merge two owners or issue a separate guest-management bearer link.
6. **Future option, not implemented:** passkeys may provide a phishing-resistant account upgrade or step-up mechanism. They would not replace action-specific review and confirmation.

A current owner may optionally enable recovery either from `/saved` or entirely through the external agent client. `enable_workspace_recovery` uses the existing owner-bound email start/complete endpoints and returns only the challenge ID, expiry, and next step; it drops the email, endpoint, masked destination, local development code, owner, and verification record. This setup is not consent, application approval, or an alert subscription.

A verified owner can later recover access without a password either from `/saved` or entirely through the external agent client. `recover_jobbbler_workspace` uses a strict two-step input: start with the verified email explicitly supplied by the person, then complete with the exact opaque recovery ID and six-digit code. Recovery start returns the same accepted response shape and status whether or not an address exists, with a minimum response-time floor. This is application-level enumeration resistance, not a claim of cryptographically constant-time mail-provider delivery. A separate short-lived, single-use recovery challenge is delivered only to a matching verified encrypted endpoint; only its keyed hash is stored. Successful consumption and rotation to one new opaque HttpOnly session happen atomically, with every prior session revoked. The start result returns only the temporary recovery ID and expiry; neither phase echoes the email or code or returns owner identity, private data, or a session credential. `get_applications` and `get_saved_alerts` can then rediscover owner-scoped work; the application index excludes answers and candidate fields. Owner activity also omits private recovery values.

Search-alert delivery reuses a verified email endpoint only when its protected
address hash belongs to the same owner. The mailbox code proves control of a
new destination; it is not the person's alert decision or data consent. Every
new alert still receives a separate immutable review and an explicit
request-bound decision in the external agent client. The release does not
silently edit an active alert: changing criteria, recurrence, or destination
means pausing or deleting the old alert and approving a replacement. A code is
requested only when that review names a new destination. Reuse is rejected if
the endpoint was revoked or ceased to be verified before activation, and an
ambiguous retry restores the originally persisted verification mode rather
than silently changing the review.

Private-data deletion is also human-only. The current owner session must first create a five-minute deletion intent by typing `DELETE MY PRIVATE DATA`, then consume it with a second exact `DELETE` confirmation. The storage adapter fences the live session and intent in one transaction, removes all owner-owned private rows, clears the browser session cookie, and retains only non-identifying redacted audit tombstones needed for integrity. Neither step is registered as a WebMCP tool.

The current implementation keeps identity portable across both storage adapters. Supabase anonymous Auth remains a compatible future adapter, not a hidden production dependency; Supabase warns that anonymous users cannot recover an account after sign-out or cleared browser data and must be distinguished in RLS policies: [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous).

## Agent authorization flow

1. A WebMCP command reaches the Policy Enforcement Point in the BFF.
2. The backend evaluates the owner session, agent session, resource, action, state, expiry, and risk.
3. If authority is absent but requestable, the response is a structured denial with a non-secret, server-issued request ID, bounded presentation facts or a compact owner-review reference, and `requires_user_action` status.
4. A compatible external agent client presents the named resource, operations,
   purpose, duration, and affected data classes through its own interaction UI
   or by showing the current Jobbbler surface. Neither path is a standardized
   WebMCP consent UI.
5. The person explicitly approves or declines there. While that request is
   active, the person can explicitly withdraw it through the same outcome tool.
   Silence and unrelated free-form text are not decisions.
6. The agent invokes the matching decision tool with the exact server request
   ID and normalized decision. The server rechecks the owner session, pending
   request, draft, expiry, and expected state, then stores a versioned
   `agent_client` interaction receipt. This is durable evidence of the exact
   request and recorded decision, not cryptographic proof of the human, model,
   or agent vendor.
7. Approval creates server-side, draft-bound delegation; no reusable secret is
   returned through WebMCP.
8. The original command is not automatically replayed. The agent retries, and the backend performs a fresh authorization evaluation.
9. Request-bound withdrawal, expiry, resource version changes, owner changes,
   or risk-policy changes take effect at the next evaluation.

This follows the useful AuthZEN requestable-denial principle: approval workflow creates new authority, but the enforcement point still re-evaluates before allowing an operation.

### Delegation record

The current record stores:

- delegation ID;
- human owner ID;
- opaque browser agent session ID;
- resource type and ID;
- exact operations;
- purpose and the exact server-issued request ID;
- created, expiry, approved, and revoked timestamps;
- decision channel, normalized approve/decline/revoke action, and evidence-contract version;

Separate owner-activity records keep safe summaries and request correlation without storing raw
chat text or secrets.

The browser agent session ID is a scoping handle, not a claim that Jobbbler has authenticated a particular model vendor. If a future client supplies a verifiable identity, it is stored separately as `verified_client_id`.

## Data authorization and consent

The agent may request a data operation. For the final application review,
Jobbbler freezes every exact field value and sensitivity marker on the visible
owner review surface. WebMCP returns only a compact request-bound reference
with the review URL, recipient, purpose, field and sensitivity counts, notice
version, draft version, and expiry; the exact values are not serialized into the
WebMCP JSON result. They remain on the visible owner review page, which a
compatible client may show or observe as the current tab or surface. The
matching decision tool accepts only the exact live request ID, current draft
version, and normalized decision. The server rechecks that exact request against
the unchanged review snapshot, then stores the request-bound `agent_client`
action. Stored consent evidence represents the reviewed values with field keys
and a payload hash, not the raw values. This verifies the exact request and
server state, not the human, model, or agent-vendor identity.

Before optional AI processing or disclosure to an employer, the visible owner
review presentation shows:

- controller or recipient identity;
- specific purpose;
- exact field values with sensitivity and document-category markers;
- processing operations, including whether an AI provider is involved;
- retention and withdrawal or deletion consequences;
- privacy-notice and consent-copy versions;
- whether refusing is compatible with the core service;
- a clear affirmative action that is never preselected or inferred from silence.

The grant stores owner, recipient, purpose, field keys, documents, a payload
hash, policy versions, legal-basis classification, approval channel, server
request ID, normalized affirmative action, evidence-contract version,
timestamps, expiry, and withdrawal evidence. It does not retain the raw review
values or raw chat text. A new recipient, purpose, field category, document, or
materially changed payload requires a new grant.

A requested grant is reusable only when its stored decision channel and server
request ID match the current interaction lineage. Switching between a manual
decision and an agent-client decision deterministically withdraws the
incompatible pending grant and creates a correctly bound replacement.

For the Jobbbler demo application, disclosure to the hiring organization uses
explicit consent. The review presentation states the right to withdraw before
the person decides. `withdraw_application_consent` is available through the
same global WebMCP surface and withdraws every live consent-based grant for the
named application in one idempotent call. The server records the channel,
interaction request ID, normalized withdrawal action, evidence version, and
time. It also advances a draft-scoped consent revision included in future
disclosure hashes, so an earlier approval cannot be replayed after withdrawal.
Withdrawal stops future processing under that consent; it does not erase
the application, revoke agent delegation, or retract a disclosure already sent.
Those are deliberately separate controls.

Consent is not used as a marketing label for every instruction. Agent
delegation and submission confirmation remain authorization controls, not
consent. Other processing may use a different lawful basis; Jobbbler records
the classification separately and does not claim jurisdiction-wide legal
compliance without review. Where consent is the basis, it must be freely given,
specific, informed, unambiguous, affirmative, and reversible, consistent with
[EDPB Guidelines 05/2020](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_202005_consent_en.pdf).

## Submission invariant

An internal submission is allowed only when all statements are true in one transaction:

- the authenticated owner owns the draft and meets the required verification level;
- the agent delegation, if the command is agent-initiated, permits `submit_application` for this draft;
- the immutable review version equals the current draft version;
- recipient, requirement, document, declaration, and payload hashes match;
- every required data grant is active and covers the exact disclosure;
- the confirmation is unused, unexpired, and bound to this owner and review;
- the idempotency key is valid and either new or mapped to the same response;
- for a first-party submission, the draft still has no requested or active
  assistance and no agent-suggested answer when the storage transaction locks
  the draft;
- no withdrawal, assistance request, or material edit won the race before the
  adapter claim.

Submission token consumption, state transition, audit record, outbox event, and idempotency response commit atomically for Jobbbler-managed demo applications. Every role in the current demo catalog uses that path. The command still rejects any unsupported future application mode before creating an application, preparing data, or recording a receipt. Historical `handed_off` records are read-only legacy compatibility and cannot be created by current server or storage writers.

## Token classes

Verification challenge, owner session, recovery challenge, agent delegation reference, and application confirmation are separate classes with explicit audience, scope, storage, TTL, replay, revocation, and logging rules. Raw values are random, stored hashed when lookup permits, and never placed in analytics. The release does not expose reusable management credentials through URLs or WebMCP results.

OAuth security guidance recommends sender-constrained and audience-restricted access tokens to limit stolen-token misuse: [OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.10). DPoP is an application-layer proof-of-possession mechanism suitable for compatible public clients: [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html). Those standards inform external-agent support; they are not retrofitted into WebMCP without client support.

## Privacy and security invariants

- Tool schemas ask only for data necessary to perform the named operation; they do not harvest personalization context.
- Sensitive values and documents are entered or selected through the private owner workflow, not echoed through tool outputs.
- Audit events identify decisions and hashes but redact secrets and high-risk personal content.
- Access uses deny-by-default policy, resource ownership, and aggregate version checks.
- Every grant and delegation has an accessible revoke surface and deterministic expiry.
- Consent withdrawal stops future consent-based processing; it does not falsify a lawful historical submission receipt.
- Deletion and retention rules cover derived AI artifacts, audit minimization, and downstream-recipient limits.
- Durable IP/session rate limits, CSRF/origin checks, strict input bounds, opaque cookies, and RLS protect the progressive identity path.

## Required evidence

- Unit tests for cross-owner, cross-draft, cross-action, expired, revoked, replayed, and payload-change failures.
- Integration tests proving a mismatched or stale interaction request cannot approve a grant and a successful approval still requires re-evaluation.
- Agent-client scenario tests for clear request presentation, exact decision
  binding, withdrawal, revoke, and expired confirmation; browser tests cover
  the ordinary portal and judge-facing activity projection.
- RLS tests that distinguish anonymous and verified owners.
- Redaction tests ensuring no raw token, application answer, or document enters tool output, realtime payload, or log.
- A concise public threat model and an end-to-end demo of request, approval, action, revoke, and denied retry.
