# Task 9 Application Atomicity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make material application edits and confirmed submission one owner-scoped, retry-safe storage transaction in SQLite and PostgreSQL.

**Architecture:** Extend the shared `ApplicationRepository` with immutable operation input/output records. SQLite performs all mutations in a Better SQLite transaction; PostgreSQL performs the equivalent reads, guarded updates, invalidations, and receipt insert in `sql.begin`. The adapters use the same owner, draft-version, review/hash, confirmation, and rich-grant checks.

**Tech Stack:** TypeScript, Zod contract types, better-sqlite3, PostgreSQL (`postgres`), Vitest.

**Spec:** User Task 9 request in this thread.

## Global Constraints

- Modify only shared storage, SQLite, PostgreSQL migrations/adapters/tests, and this plan; do not touch web handlers or UI.
- Raw confirmation tokens remain outside persistence; only `confirmationHash` is accepted.
- Do not commit.

---

### Task 1: Shared repository contract

**Files:**

- Modify: `packages/storage/src/records.ts`
- Modify: `packages/storage/src/repositories.ts`
- Test: `packages/storage-sqlite/src/application-authorization-repository.test.ts`

**Produces:** `MaterialApplicationEditInput`, `CompleteApplicationSubmissionInput`, `CompleteApplicationSubmissionResult`, latest-review/latest-receipt methods, and two atomic repository operations.

- [ ] **Step 1: Write failing storage tests**

```ts
await expect(storage.applications.getLatestReview(draftId, ownerId)).resolves.toEqual(review);
await expect(storage.applications.completeSubmission(input)).resolves.toMatchObject({
  draft,
  receipt,
});
```

- [ ] **Step 2: Run the focused SQLite test and verify it fails because the methods do not exist.**

- [ ] **Step 3: Add the exact shared input/output record types and repository signatures.**

- [ ] **Step 4: Re-run typecheck; it must report the two adapters missing the new methods.**

### Task 2: SQLite transactional implementation

**Files:**

- Modify: `packages/storage-sqlite/src/storage.ts`
- Modify: `packages/storage-sqlite/src/application-authorization-repository.test.ts`
- Modify: `packages/storage-sqlite/src/migrate.test.ts`
- Create: `migrations/sqlite/0012_application_atomicity.sql`

- [ ] **Step 1: Write tests for material-edit invalidation, rollback on a conflict, current-artifact lookup, submission idempotency, expired/replayed confirmation, stale review/version, grant-scope mismatch, and cross-owner denial.**
- [ ] **Step 2: Run the focused test and verify failure.**
- [ ] **Step 3: Implement SQLite `database.transaction` operations. The edit updates only when `version = expectedVersion`, invalidates active reviews and confirmations, deletes stale rich grants, and returns the new draft. The submit operation first returns a same-bound receipt for an existing idempotency key; otherwise it validates exact artifacts, consumes the confirmation, increments draft version/state, and inserts the receipt.**
- [ ] **Step 4: Add migration indexes for newest artifact reads and update migration-count assertions.**
- [ ] **Step 5: Run focused SQLite tests and typecheck.**

### Task 3: PostgreSQL parity

**Files:**

- Modify: `packages/storage-postgres/src/storage.ts`
- Modify: `packages/storage-postgres/src/storage.integration.test.ts`
- Modify: `packages/storage-postgres/src/migrate.test.ts`
- Create: `migrations/postgres/0007_application_atomicity.sql`

- [ ] **Step 1: Add opt-in integration cases using the same records: latest ordering, invalidation, idempotent repeat, and revoked/expired/cross-owner rejection.**
- [ ] **Step 2: Run typecheck and verify the adapter is missing the new interface methods.**
- [ ] **Step 3: Implement each operation inside `sql.begin`, lock the draft and confirmation rows with `FOR UPDATE`, use guarded writes, and return `{ draft, receipt }`.**
- [ ] **Step 4: Add JSON record indexes supporting newest review/receipt lookup and exact active grant lookup; update static migration assertions.**
- [ ] **Step 5: Run PostgreSQL static tests/typecheck; run opt-in integration tests when `POSTGRES_TEST_DATABASE_URL` is available.**

### Task 4: Verification

**Files:**

- Test: `packages/storage-sqlite/src/application-authorization-repository.test.ts`
- Test: `packages/storage-postgres/src/storage.integration.test.ts`

- [ ] **Step 1: Run storage, SQLite, and PostgreSQL typechecks.**
- [ ] **Step 2: Run focused SQLite and PostgreSQL tests.**
- [ ] **Step 3: Run `git diff --check` for only Task 9 paths and report skipped PostgreSQL integration explicitly if no database URL is configured.**
