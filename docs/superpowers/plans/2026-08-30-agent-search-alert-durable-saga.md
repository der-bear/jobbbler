# Agent Search Alert Durable Saga Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing agent-native search-alert request and decision tools exactly retryable across concurrency, provider ambiguity, process crashes, and expiry without persisting raw OTP or separating schedules from receipts.

**Architecture:** A short-lived request saga atomically preallocates stable resource identifiers before side effects, while exact `claimId` leases serialize execution. Search-alert OTP is re-derived from its stable challenge context, and a narrow cross-adapter coordinator atomically commits an approved schedule with its long-lived, review-bound receipt.

**Tech Stack:** TypeScript, Zod, Vitest, SQLite/better-sqlite3, PostgreSQL/postgres.js, existing worker cadence.

**Spec:** `docs/superpowers/specs/2026-08-30-agent-search-alert-durable-saga-design.md`

## Global Constraints

- Keep the public `request_search_alert` and `decide_search_alert` schemas stable; do not add UI or site clicks.
- The external agent client supplies `Idempotency-Key` and the explicit decision.
- Never persist or expose raw OTP in production.
- Never use an unkeyed digest over raw email or another low-entropy identifier.
- Decline never validates or consumes the mailbox challenge; approval always consumes the exact review-bound challenge.
- Verified/reused endpoints and unrelated verification/recovery state are never downgraded or purged.
- Write and run one focused failing test before each production change; record exact RED and GREEN output.

---

### Task 1: Stable private saga and consent-evidence primitives

**Files:**

- Create: `apps/web/src/server/search-alert-saga.ts`
- Create: `apps/web/src/server/search-alert-saga.test.ts`
- Modify: `apps/web/src/server/search-alert-review-token.ts`
- Modify: `apps/web/src/server/search-alert-review-token.test.ts`
- Modify: `apps/web/src/server/identity-security.ts`
- Modify: `apps/web/src/server/identity-security.test.ts`
- Modify: `packages/core-domain/src/ownership/types.ts`

**Interfaces:**

- Produces `createSearchAlertRequestBinding(environment, input, keyedAddressId): string`, a purpose-separated keyed HMAC over canonical non-PII policy and the already keyed address identifier.
- Produces strict internal `searchAlertRequestSagaSchema`, `searchAlertDecisionIntentSchema`, and `searchAlertDecisionEnvelopeSchema` parsers.
- Adds internal `scheduleId` to `SearchAlertReviewPayload` without changing either public tool schema.
- Adds `SecretCodec.deriveSearchAlertVerificationCode(challengeId: string): string`.

- [ ] **Step 1: Add focused tests** proving same canonical policy/address identifier yields one binding, changed policy differs, raw email is absent, stable challenge context yields the same six-digit code, different challenges differ, and the internal token round-trips `scheduleId`.
- [ ] **Step 2: Run RED:** `pnpm --filter @jobbbler/web test --run src/server/search-alert-saga.test.ts src/server/identity-security.test.ts src/server/search-alert-review-token.test.ts`; expect missing primitives/interface failures.
- [ ] **Step 3: Implement the minimal primitives.** Use HMAC domains `jobbbler:search-alert-request-binding:v1` and `jobbbler:search-alert-otp:v1`; derive the OTP from secret HMAC bytes modulo 1,000,000 and zero-pad to six digits. The decision envelope stores the public receipt plus redacted evidence: purpose, data categories, retention, withdrawal, criteria, saved-search ID/version, endpoint ID, recurrence, first run, privacy version, channel, decidedAt, and keyed review binding; it excludes token, challenge, code, and email.
- [ ] **Step 4: Run GREEN** with the Step 2 command.

### Task 2: Idempotent saga resources and monotonic endpoints

**Files:**

- Modify: `packages/core-domain/src/saved-searches/service.ts`
- Modify: `packages/core-domain/src/saved-searches/service.test.ts`
- Modify: `packages/core-domain/src/ownership/service.ts`
- Modify: `packages/core-domain/src/ownership/service.test.ts`
- Modify: `packages/core-domain/src/ownership/types.ts`
- Modify: `packages/storage-sqlite/src/identity-repository.ts`
- Modify: `packages/storage-sqlite/src/identity-repository.test.ts`
- Modify: `packages/storage-postgres/src/storage.ts`
- Modify: `packages/storage-postgres/src/search-alert-verification.integration.test.ts`
- Create: `packages/storage-postgres/src/verification-endpoint-monotonicity.test.ts`

**Interfaces:**

- Produces `ensureSavedSearch(ownerId, savedSearchId, input, createdAt): Promise<SavedSearch>`; exact retries return the existing record, drift conflicts.
- Extends `startSearchAlertEmailVerification` with stable `{ endpointId, challengeId }` context and uses `deriveSearchAlertVerificationCode`.
- Makes `beginEmailVerification` return an exact existing same-ID alert challenge and endpoint, but reject a mismatched collision.

- [ ] **Step 1: Add saved-search and identity RED tests** for crash-style re-entry with the same IDs/code and mismatched replay conflict.
- [ ] **Step 2: Run RED:** focused core-domain service tests; expect duplicate insert/conflict and missing stable-context API.
- [ ] **Step 3: Implement exact idempotent resource creation** with compare-after-conflict so concurrent creators converge without weakening ordinary verification randomness.
- [ ] **Step 4: Run GREEN** for focused core-domain and SQLite tests.
- [ ] **Step 5: Add a PostgreSQL RED test** whose fake transaction changes a pending endpoint to verified/revoked between an unlocked snapshot and write; require the matching endpoint query to use `FOR UPDATE` and return the terminal row.
- [ ] **Step 6: Run RED:** `pnpm --filter @jobbbler/storage-postgres test --run src/verification-endpoint-monotonicity.test.ts`; expect the stale pending overwrite.
- [ ] **Step 7: Replace the PostgreSQL owner-wide unlocked list with a matching-row `FOR UPDATE` query** before any endpoint write, preserving verified/revoked rows observed after lock wait.
- [ ] **Step 8: Run GREEN** for the PostgreSQL unit test and the live integration case.

### Task 3: Exact idempotency leases, bounded purge, and isolated maintenance

**Files:**

- Modify: `packages/storage/src/records.ts`
- Modify: `packages/storage/src/repositories.ts`
- Modify: `packages/storage/src/contract-tests/storage.contract.ts`
- Modify: `packages/storage-sqlite/src/storage.ts`
- Modify: `packages/storage-sqlite/src/idempotency-claims.test.ts`
- Modify: `packages/storage-postgres/src/storage.ts`
- Modify: `packages/storage-postgres/src/idempotency-atomicity.test.ts`
- Modify: `packages/storage-postgres/src/idempotency-atomicity.integration.test.ts`
- Modify: `apps/worker/src/search-alert-retention.ts`
- Modify: `apps/worker/src/search-alert-retention.test.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**

- Replaces `delete(scope, key, requestHash)` with `deleteExact(input: Pick<IdempotencyRecord, "scope" | "key" | "requestHash" | "responseBody">): Promise<boolean>`.
- Adds `purgeExpired(input: { scopePrefix: string; now: string; limit: number }): Promise<number>` with a 1..1000 bound.
- Retention returns `{ purgedPreparations, purgedIdempotency, failed }` and never rejects for an adapter maintenance failure.

- [ ] **Step 1: Add an ABA RED test**: insert old same-hash lease/body, replace it with a fresh body containing a different `claimId`, then prove stale exact delete returns false and fresh remains.
- [ ] **Step 2: Run RED** for SQLite and PostgreSQL idempotency tests; expect fresh record deletion/current method-shape failure.
- [ ] **Step 3: Implement exact JSON compare-delete** (`response_body_json = ?` in SQLite and JSONB equality in PostgreSQL), and bind every lease body to a fresh `claimId`.
- [ ] **Step 4: Run GREEN** for adapter ABA/atomicity tests.
- [ ] **Step 5: Add cross-adapter RED contract tests** proving bounded expiry deletion affects only `search_alert.` scopes and preserves fresh/unrelated records.
- [ ] **Step 6: Implement bounded adapter purge** using an immediate SQLite transaction and PostgreSQL `FOR UPDATE SKIP LOCKED` CTE/transaction.
- [ ] **Step 7: Add worker RED tests** where verification cleanup rejects but idempotency cleanup still runs and the helper resolves a safe failure marker.
- [ ] **Step 8: Implement independent best-effort cleanup** and wire its counts/failures into the existing cycle log without throwing into catalog/scheduler/delivery.
- [ ] **Step 9: Run GREEN** for contracts, adapters, and worker retention.

### Task 4: Durable request preparation and ambiguous-delivery resume

**Files:**

- Modify: `apps/web/src/server/search-alert-agent-route-handlers.ts`
- Modify: `apps/web/src/server/search-alert-agent-route-handlers.test.ts`
- Modify: `apps/web/src/server/identity-route-handlers.ts`
- Modify: `apps/web/src/server/saved-searches.ts`

**Interfaces:**

- Request saga body preallocates `requestId`, `savedSearchId`, `endpointId`, `challengeId`, `scheduleId`, and `issuedAt` before effects.
- A separate request execution lease contains fresh `claimId` and is exact-deleted.
- Retryable/ambiguous delivery errors preserve saga resources; definitive errors compensate and exact-delete the saga.

- [ ] **Step 1: Add RED tests** for crashes immediately after saved-search creation and challenge creation; retry with the same key must reuse every ID and create no duplicate.
- [ ] **Step 2: Run RED** for those focused handler tests; expect duplicate create calls/conflict.
- [ ] **Step 3: Implement create/load saga before effects** and call the idempotent resource APIs with its stable IDs/timestamp.
- [ ] **Step 4: Run GREEN** for crash-boundary resource tests.
- [ ] **Step 5: Add accepted-then-timeout RED test** where first delivery throws retryable after recording its input and second same-key call succeeds; assert identical challenge, code, expiry, provider key context, saved search, and final review, with no raw code in any stored idempotency body or response.
- [ ] **Step 6: Implement ambiguity preservation/resume**; only compensate a delivery error proven non-retryable, and use the same stable saga until its bounded expiry.
- [ ] **Step 7: Run GREEN** for all request handler cases, including existing failure compensation and sequential/concurrent replay.

### Task 5: Atomic SQLite/PostgreSQL schedule plus consent receipt

**Files:**

- Modify: `packages/storage/src/records.ts`
- Modify: `packages/storage/src/repositories.ts`
- Modify: `packages/storage/src/contract-tests/storage.contract.ts`
- Modify: `packages/storage-sqlite/src/storage.ts`
- Modify: `packages/storage-postgres/src/storage.ts`
- Create: `packages/storage-postgres/src/search-alert-activation.integration.test.ts`

**Interfaces:**

- Adds `SearchAlertActivationRepository.commitApproved(input)` where input contains exact `ScheduleRecord`, expected saved-search version, verified endpoint ID, and decision `IdempotencyRecord` envelope.
- Returns `{ inserted, schedule, decision }`; an exact retry returns the committed pair, and any mismatch conflicts.

- [ ] **Step 1: Add cross-adapter RED contract tests** for atomic success, exact replay, different receipt/schedule conflict, stale search version, revoked endpoint, and an injected receipt-insert failure leaving no schedule.
- [ ] **Step 2: Run RED** for SQLite storage contracts and the live PostgreSQL integration; expect missing coordinator/non-atomic schedule state.
- [ ] **Step 3: Implement SQLite immediate transaction** that locks via the transaction, revalidates owner/search version/endpoint, accepts an identical existing schedule, inserts schedule and receipt, and rolls back both on any failure.
- [ ] **Step 4: Implement PostgreSQL transaction** with `FOR UPDATE` on saved search, endpoint, existing schedule, and decision key, then atomic insert/return with identical replay checks.
- [ ] **Step 5: Run GREEN** for both adapters, including concurrent equal/opposite commit attempts.

### Task 6: Durable decision intent, exact schedule consent, and replay

**Files:**

- Modify: `apps/web/src/server/search-alert-agent-route-handlers.ts`
- Modify: `apps/web/src/server/search-alert-agent-route-handlers.test.ts`
- Modify: `apps/web/src/server/search-alert-review-token.ts`
- Modify: `apps/web/src/server/saved-searches.ts`

**Interfaces:**

- Receipt lookup parses the internal envelope, verifies its keyed full-review/decision binding, and returns only the public result.
- Exact durable intent is persisted before decline/approval effects and permits only a matching retry after live expiry.
- Approval commits the preallocated schedule at the reviewed `firstRunAt` through `commitApproved`; a fresh approval whose prospective run drifted conflicts before OTP consumption.

- [ ] **Step 1: Add first-run RED test** advancing decision time across a recurrence boundary; expect conflict before confirmation/schedule instead of a silently changed run.
- [ ] **Step 2: Implement exact prospective-run comparison before fresh approval intent** and run GREEN.
- [ ] **Step 3: Add expiry replay RED tests** for approved and declined receipts after short-lived request saga/evidence cleanup; expect identical receipt and no challenge mutation/schedule duplication.
- [ ] **Step 4: Implement receipt-first ordering and full redacted evidence envelope** keyed to the authenticated review; run GREEN.
- [ ] **Step 5: Add crash RED tests** after challenge consumption and at the adapter commit boundary; a same-decision retry (including after expiry when a live-created intent exists) must return the same exact receipt, while opposite decision conflicts.
- [ ] **Step 6: Implement durable decision intent plus exact execution lease**, approval through atomic storage commit, and decline receipt-before-cleanup; run GREEN for all handler decision tests.
- [ ] **Step 7: Assert long-lived consent evidence survives short-lived saga purge** and contains policy/data categories/purpose/retention/withdrawal/criteria/schedule bindings but no token/challenge/code/email.

### Task 7: Verification, independent re-review, and implementation commit

**Files:**

- Modify: `docs/superpowers/plans/2026-08-30-agent-search-alert-hardening.md`
- Review: every file in this plan and the final staged diff.

- [ ] **Step 1: Run focused alert, identity, saved-search, adapter, retention, contract, and worker suites; record exact pass counts.**
- [ ] **Step 2: Run live PostgreSQL concurrency/atomicity/retention tests in an isolated temporary database and remove the fixture.**
- [ ] **Step 3: Run affected package typechecks, lint, format check, `git diff --check`, and the full repository test suite.**
- [ ] **Step 4: Request independent exact-line re-review; fix every Critical/Important finding with another RED→GREEN cycle.**
- [ ] **Step 5: Stage only owned paths, inspect `git diff --cached --name-only` and `--check`, then commit with `fix: harden agent search alert activation`.**
- [ ] **Step 6: Report exact RED/GREEN evidence, commit SHA, files, cleanup semantics, and any lower-severity residual risk.**
