# Agent Search Alert Durable Saga Design

**Date:** 2026-08-30

## Goal

Make the existing agent-native `request_search_alert` and `decide_search_alert` flow safe across concurrent requests, ambiguous email-provider responses, process crashes, expiry, and retries without changing the public two-tool API or adding UI/site interaction.

The server continues to store owner-bound review evidence. The external agent client supplies the client idempotency key and the explicit decision. A decline never requires or consumes a mailbox code. An approval always consumes the challenge bound to that exact review.

## Privacy and evidence rules

- Raw email appears only at the authenticated request boundary and inside the existing encrypted endpoint envelope.
- Raw OTP is never persisted or returned by the production API. Search-alert OTPs are deterministically derived with a purpose-separated HMAC over the durable challenge context, and only the existing purpose-separated verification hash is stored.
- No unkeyed digest covers raw email or another low-entropy identifier. Request binding uses a purpose-separated keyed HMAC over canonical non-PII policy plus the already keyed email address identifier.
- Durable request saga records contain stable resource identifiers, timestamps, keyed request binding, and workflow state only. They contain no raw email, encrypted email, raw OTP, or provider response body.
- Durable decisions are bound to the authenticated review payload, owner, request, and exact decision. Receipts remain redacted.

## Request preparation saga

Before creating a saved search, challenge, or delivery attempt, the handler atomically creates or loads a request-saga record under the owner and client `Idempotency-Key`. The record preallocates stable request, saved-search, endpoint-candidate, challenge, and schedule identifiers plus one stable issue time. A different canonical request binding under the same client key conflicts.

Execution uses a separate short lease with a fresh `claimId`. Lease deletion compares the exact lease body, so an expired observer cannot delete a newer same-hash lease. Every saga side effect is idempotent by the preallocated identifiers:

1. Ensure the exact saved search exists, returning it only if all bound fields match.
2. Start or resume the exact alert-scoped verification challenge. Its HMAC-derived OTP, expiry, endpoint binding, and provider idempotency key remain stable across retries. A matching revoked shared endpoint conflicts atomically before challenge creation or delivery, so the agent never presents an unusable OTP.
3. Deliver with the existing provider key derived from `challengeId`.
4. Persist the exact review evidence and response, then return it on all later matching retries.

A retryable or ambiguous delivery failure preserves the saga, provisional saved search, and challenge so a retry repeats the identical provider request. A definitive pre-acceptance failure compensates them atomically. The saved search remains provisional until approval: decline, live expiry, and unattended expiry delete it only while its exact version-zero record is unchanged and unscheduled. A user-adopted or activated search is preserved. Bounded lifecycle retention removes the expired saga, review records, challenge, provisional search, and still-orphaned pending endpoint as one adapter transaction. The saga is deleted last, so a partial cleanup can be retried. Verified/reused endpoints and unrelated verification/recovery records are never purged.

## Decision intent and atomic activation

After authenticating the owner-bound review token, the handler first replays any exact durable receipt, even if the live review has since expired. The receipt binding must match the full authenticated review and requested decision.

Without a receipt, a fresh decision must still have live request evidence and be unexpired. Approval additionally verifies that the current prospective first run still equals the reviewed `firstRunAt`; drift causes a conflict before challenge consumption. A lifecycle coordinator locks the exact preparation saga and atomically stores a 24-hour exact approval intent while revalidating the live request evidence. An opposite decision or concurrent expiry conflicts. A matching live intent proves the approval arrived while the review was live, so a retry may resume it after review expiry or after the short execution lease expires; unattended state becomes eligible for lifecycle cleanup when that bounded recovery window closes.

Decline never validates or consumes an OTP. The lifecycle coordinator validates the live exact review, persists the redacted receipt, deletes the unchanged provisional search, exact review challenge, pending orphan endpoint, intent, and short review records, then deletes the saga in one transaction. Durable receipt replay is therefore read-only.

Approval consumes the exact purpose-bound challenge, accepting only an exact already-consumed replay. The lifecycle coordinator then commits the preallocated schedule and approved receipt and removes the consumed challenge, intent, saga, and short review records in one adapter transaction. The transaction locks and revalidates the saved-search version and verified endpoint, accepts only an identical pre-existing schedule/receipt, and otherwise rolls back every change. Therefore a crash cannot leave a schedule without its replay receipt, matching retries cannot create a duplicate schedule, and completed workflows retain only the activated resources plus long-lived redacted evidence.

## Adapter and maintenance invariants

- SQLite uses immediate transactions and exact JSON lease comparison.
- PostgreSQL uses one atomic insert for idempotency claims, exact JSON lease comparison, row locks for shared verification endpoint transitions, and one transaction for schedule plus receipt.
- A dedicated preparation-lifecycle repository owns request saga/evidence/result and decision-intent cleanup. Generic idempotency retention excludes those lifecycle-owned scope families and deletes only independent expired claim/final-receipt records in bounded batches.
- Lifecycle purge excludes live bounded approval intents and exact committed approvals before applying its batch limit, so protected records cannot starve later eligible provisional data.
- Lifecycle and generic idempotency cleanup run as independent best-effort maintenance work. Expired review challenges are purged only through the saga-aware lifecycle, so an approved in-progress intent keeps its exact consumed proof. A cleanup failure is reported as a bounded safe count/status and cannot abort catalog scheduling or alert delivery.

## Verification

Strict TDD records RED before each production change. Focused tests cover:

- stale-lease ABA takeover and release;
- concurrent PostgreSQL begin-versus-confirm/revoke monotonicity;
- ambiguous accepted-then-timeout delivery followed by exact saga resume;
- crash/retry boundaries after saved-search creation, challenge creation, delivery, challenge consumption, and activation commit;
- exact `firstRunAt` drift rejection;
- post-expiry durable receipt replay and matching intent resume;
- opposite decisions under concurrency;
- atomic schedule/receipt parity in SQLite and PostgreSQL;
- atomic decline/live-expiry cleanup and read-only receipt replay;
- intent-versus-expiry and activation-versus-cleanup races;
- bounded saga-aware retention and worker-cycle failure isolation.

Final verification includes focused suites, cross-adapter live PostgreSQL tests, affected package typechecks/lint/format, the repository test suite, diff inspection, and an independent security/correctness re-review before the implementation commit.
