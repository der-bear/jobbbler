# Agent-native alert activation design

**Date:** 2026-08-30  
**Status:** Approved by the kickoff requirements and the explicit product rule that a person completes agent workflows in the external agent client, without operating Jobbbler itself

## Problem

Jobbbler can already run durable saved-search schedules without an open browser,
but the current WebMCP surface begins only after an alert exists. The
`monitor_search` workflow tells a person to save the search and verify an email
on the Saved page. That contradicts both the kickoff's no-account monitoring
journey and the approved agent-first interaction model.

The missing outcome is one coherent external-agent flow:

1. preserve the exact search worth monitoring;
2. prove control of the delivery mailbox;
3. show the exact recurrence, destination, data use, and withdrawal boundary in
   the external agent client;
4. activate the backend schedule only after the person's bound decision; and
5. continue running after the browser closes.

## Decision

Add two outcome-level imperative WebMCP tools, registered globally with the
existing catalog:

- `request_search_alert` prepares a private saved search, starts mailbox
  verification, and returns one exact, expiring review for the external agent
  client. It sends a verification code but activates no schedule.
- `decide_search_alert` consumes the exact server request, mailbox code, and the
  person's explicit `approved` or `declined` decision. Approval verifies the
  endpoint and activates the unchanged schedule; decline creates no schedule.

The surface grows from 24 to 26 tools. This is smaller and less ambiguous than
mirroring every Saved-page control with separate save, preview, verify, and
schedule tools. It follows the same request/decision grammar as application
assistance and final submission.

## Alternatives rejected

### Keep the current site handoff

This is simplest technically, but it makes the flagship persistent-monitoring
outcome impossible for an external agent and violates the approved no-site-touch
rule.

### Add three or more granular tools

Separate preview, verification-start, verification-complete, save, and activate
tools expose implementation order instead of a user outcome. Weak models must
coordinate more IDs and can activate a policy different from the one reviewed.

### Accept an agent-supplied `verified: true`

This confuses consent with mailbox control and is not evidence of either. The
server must validate the one-time code against its stored challenge.

## Request flow

`request_search_alert` accepts:

- a short saved-search name;
- canonical `JobSearchCriteria` (normally from `search_jobs` or the visible
  search state);
- a daily or weekly recurrence with an IANA timezone; and
- the delivery email supplied by the person in the external agent client.

The tool first ensures an ephemeral private owner session. The server then:

1. parses and canonicalizes the search and recurrence;
2. creates the private saved search with no delivery schedule;
3. creates an owner-bound pending email endpoint and sends a rate-limited
   six-digit challenge;
4. calculates the first prospective run;
5. signs an opaque review token bound to owner, saved-search ID and version,
   endpoint, challenge, recurrence, privacy-copy version, issued time, and
   expiry; and
6. returns `requires_user_action` with the masked destination, exact criteria,
   recurrence, first prospective run, purpose, data categories, retention
   boundary, and right to withdraw.

The raw email is encrypted by the existing endpoint service and never appears
in the review token, activity feed, logs, or tool result.

The external agent client presents that review and asks the person for the
mailbox code plus an explicit activation decision. No site click is required.

## Decision flow

`decide_search_alert` accepts the server request ID, opaque review token,
six-digit code, and `approved` or `declined`.

The server validates, in order:

1. same-origin mutation and owner session;
2. token signature, purpose, expiry, and exact owner/request binding;
3. saved-search existence and unchanged version;
4. pending endpoint and challenge ownership;
5. the person's decision channel (`agent_client`); and
6. the one-time verification code.

On `declined`, the server records the declined request and creates no schedule;
the private saved search remains available and the pending endpoint expires.

On `approved`, the server verifies the endpoint and calls the existing schedule
service with only the recurrence and endpoint bound into the signed review. The
schedule service revalidates ownership and returns an identical existing
schedule on retry, making activation idempotent. The response contains the
saved-search and schedule IDs, first run, and a receipt-like safe summary.

The route publishes a redacted owner activity event with agent provenance,
request ID, policy version, and resource versions. It never records the email,
code, or token.

## Consent and verification semantics

Mailbox verification and consent are deliberately separate facts:

- the code proves control of the delivery address;
- the explicit `approved` decision records permission to store the verified
  endpoint and deliver the reviewed alert policy; and
- the signed request proves which policy that decision covered.

This is application evidence, not cryptographic proof that a particular human
clicked a browser control. The product describes it honestly as a server record
of an external-agent-client decision. Pausing or deleting an alert remains
possible through existing owner-authorized controls; endpoint revocation stops
delivery and requires re-verification before reuse.

## Failure and retry behavior

- Invalid or expired tokens, owner mismatch, altered review fields, wrong codes,
  and stale saved-search versions fail closed.
- Rate limits apply to owner, address, client boundary, and code attempts.
- A delivery-provider failure creates no review.
- If schedule activation fails after successful mailbox verification, the
  private saved search and verified endpoint remain safe to retry; no schedule
  or success receipt is fabricated.
- Repeating an approved decision returns the identical existing schedule.
- Cancellation propagates through the WebMCP `AbortSignal` and cannot turn a
  pending request into approval.

## Product presentation

The public site remains a conventional jobs portal. No new mainstream screen is
required. Agent view groups the two additions under Alerts and shows only clear
effects such as “Alert review prepared” and “Job alert activated.” The Guide
explains that the agent client presents the mailbox code and exact activation
review; Jobbbler does not embed a second chat.

## Verification

- Contract tests cover schemas and bounded result shapes.
- Token tests cover signature, purpose, expiry, owner/request binding, and
  tampering.
- Route tests cover request, decline, approval, wrong code, stale review,
  owner mismatch, retries, activity redaction, and absence of a schedule before
  approval.
- Manifest tests cover tool names, annotations, descriptions, cancellation,
  safe errors, and the exact two-step sequence.
- Global-registration and E2E tests require the same 26 tools on every route.
- Fresh Luna-low cases verify routing and refusal to invent the code or decision;
  Terra-medium workflows exercise the complete request/decision sequence.
