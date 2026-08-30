# Agent-native alert activation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an external browser agent create and activate a durable no-login job alert through one request-bound review and one explicit decision, with no Jobbbler UI interaction.

**Architecture:** Two global WebMCP tools call dedicated same-origin routes. A signed, expiring review token binds the saved search, pending verified endpoint, recurrence, owner, and privacy-copy version; the decision route verifies the mailbox challenge and activates the unchanged schedule idempotently.

**Tech Stack:** Next.js route handlers, React WebMCP provider, TypeScript strict, Zod, existing owner/saved-search/schedule services, HMAC-SHA256, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-30-agent-native-alert-activation-design.md`

## Global constraints

- The person makes verification and activation decisions only in the external agent client; no site click is required.
- The server never trusts a model-supplied verification flag or inferred decision.
- Email, verification code, and review token never enter logs, activity payloads, or ordinary tool results.
- The exact reviewed recurrence and endpoint are immutable between request and decision.
- Local SQLite and production PostgreSQL/Supabase behavior remain equivalent.
- Every route registers the same complete tool set.
- All repository artifacts and user-facing copy are English.

---

### Task 1: Alert review contracts and signed token

**Files:**

- Create: `apps/web/src/server/search-alert-review-token.ts`
- Test: `apps/web/src/server/search-alert-review-token.test.ts`
- Modify: `packages/contracts/src/schedule.ts`
- Modify: `packages/contracts/src/schedule.test.ts`

**Interfaces:**

- Produces `requestSearchAlertInputSchema`, `requestSearchAlertResultSchema`, `decideSearchAlertInputSchema`, and `decideSearchAlertResultSchema`.
- Produces `createSearchAlertReviewCodec(environment)` with `sign(payload)` and `verify(token, expectedOwnerId, now)`.

- [ ] **Step 1: Write contract and codec tests that fail before the new schemas and codec exist**

  Cover exact strict inputs, six-digit code, decision enum, bounded criteria, signed owner/request/purpose, expiry, tamper rejection, and a token that contains endpoint IDs but no email or code.

- [ ] **Step 2: Run the focused tests and confirm the missing exports/codecs fail**

  Run: `pnpm exec vitest run packages/contracts/src/schedule.test.ts apps/web/src/server/search-alert-review-token.test.ts`

- [ ] **Step 3: Implement the strict schemas and HMAC codec**

  Use the existing `TOKEN_HASH_SECRET` production requirement, domain-separate the HMAC with `jobbbler:search-alert-review:v1`, use base64url JSON plus signature, enforce a 15-minute maximum lifetime, and compare signatures in constant time.

- [ ] **Step 4: Re-run focused tests, typecheck, and commit**

  Run: `pnpm exec vitest run packages/contracts/src/schedule.test.ts apps/web/src/server/search-alert-review-token.test.ts && pnpm --filter @jobbbler/contracts typecheck && pnpm --filter @jobbbler/web typecheck`

  Commit: `feat: bind search alert reviews`

### Task 2: Request and decision route handlers

**Files:**

- Create: `apps/web/src/server/search-alert-agent-route-handlers.ts`
- Create: `apps/web/src/server/search-alert-agent-route-handlers.test.ts`
- Create: `apps/web/src/app/api/v1/agent/search-alerts/request/route.ts`
- Create: `apps/web/src/app/api/v1/agent/search-alerts/decision/route.ts`
- Modify: `apps/web/src/server/saved-searches.ts`

**Interfaces:**

- Consumes the Task 1 schemas and codec plus existing identity, saved-search, schedule, endpoint-verification, idempotency, and activity ports.
- Produces `handleRequestSearchAlert` and `handleDecideSearchAlert`.

- [ ] **Step 1: Write failing request/decision handler tests**

  Cover owner requirement, exact preview, encrypted/masked email behavior, challenge delivery, no schedule before approval, decline, wrong code, stale or tampered token, owner mismatch, changed saved-search version, approval, identical retry, schedule failure, and redacted agent activity.

- [ ] **Step 2: Run the handler tests and confirm RED behavior**

  Run: `pnpm exec vitest run apps/web/src/server/search-alert-agent-route-handlers.test.ts`

- [ ] **Step 3: Implement request handling**

  Reuse the existing verified-owner identity service and rate limits. Create the private saved search, start verification, calculate the prospective run, sign the exact review, and return a bounded `requires_user_action` presentation. Do not activate a schedule.

- [ ] **Step 4: Implement decision handling**

  Validate the signed review and saved-search version, record decline without scheduling, or complete the email challenge and call `scheduleAlert` using only values from the token. Key idempotency to owner plus server request ID and publish a redacted `agent` activity event only after the authoritative transition.

- [ ] **Step 5: Add thin Next.js routes and run focused tests**

  Run: `pnpm exec vitest run apps/web/src/server/search-alert-agent-route-handlers.test.ts apps/web/src/server/identity-route-handlers.test.ts apps/web/src/server/saved-search-route-handlers.test.ts`

- [ ] **Step 6: Typecheck and commit**

  Run: `pnpm --filter @jobbbler/web typecheck`

  Commit: `feat: activate reviewed search alerts`

### Task 3: Global WebMCP tools and visible state

**Files:**

- Modify: `apps/web/src/features/saved/webmcp-tools.ts`
- Modify: `apps/web/src/features/saved/webmcp-tools.test.ts`
- Modify: `apps/web/src/components/webmcp-provider.tsx`
- Modify: `apps/web/src/components/webmcp-registration.ts`
- Modify: `apps/web/src/features/webmcp-workflows.ts`
- Modify: `apps/web/src/features/webmcp-workflows.test.ts`
- Modify: `apps/web/src/lib/webmcp-catalog.ts`
- Modify: `apps/web/src/lib/webmcp-catalog.test.ts`
- Modify: `evals/webmcp/saved.json`
- Modify: `tests/e2e/agent-journey.spec.ts`

**Interfaces:**

- Consumes the request/decision API contracts from Tasks 1-2.
- Produces globally registered `request_search_alert` and `decide_search_alert` manifests and a 26-tool catalog.

- [ ] **Step 1: Write failing manifest, workflow, catalog, eval-count, and global-registration tests**

  Assert the request tool includes exact search/recur/email inputs and returns a pending external-client review; assert the decision tool requires the server request, token, code, and explicit decision; assert no model can supply `verified: true`; assert every route exposes the same 26 tools.

- [ ] **Step 2: Run the focused tests and confirm the two tools are missing**

  Run: `pnpm exec vitest run apps/web/src/features/saved/webmcp-tools.test.ts apps/web/src/features/webmcp-workflows.test.ts apps/web/src/lib/webmcp-catalog.test.ts`

- [ ] **Step 3: Implement the manifests and provider dependencies**

  Ensure an ephemeral owner session before requesting an alert. Pass `AbortSignal` through every network call, use the standard safe result envelopes, update saved/alert UI state only after authoritative results, and keep review output bounded and explicitly sensitive.

- [ ] **Step 4: Replace the manual monitoring workflow step**

  The planner must sequence `search_jobs` → `get_search_state` → `request_search_alert` → external-client decision/code → `decide_search_alert` → `get_saved_alerts`. It must not direct the person to the Saved page.

- [ ] **Step 5: Add direct, paraphrased, missing-code, invented-approval, stale-review, and happy-path eval cases**

  Keep expectations semantic: safe prerequisite calls and omitted documented defaults are valid; invented code/approval is always invalid.

- [ ] **Step 6: Run focused tests and the WebMCP E2E journey, then commit**

  Run: `pnpm exec vitest run apps/web/src/features/saved/webmcp-tools.test.ts apps/web/src/features/webmcp-workflows.test.ts apps/web/src/lib/webmcp-catalog.test.ts && pnpm test:e2e --grep "agent journey"`

  Commit: `feat: expose agent-native job alerts`

### Task 4: Product copy, architecture, and model evaluation

**Files:**

- Modify: `docs/architecture/webmcp-capability-matrix.md`
- Modify: `docs/architecture/webmcp-evals.md`
- Modify: `docs/architecture/agent-authorization-and-consent.md`
- Modify: `docs/design/product-experience.md`
- Modify: `docs/submission/devpost-copy.md`
- Modify: `docs/submission/demo-storyboard.md`
- Modify: `README.md`

**Interfaces:**

- Consumes the verified 26-tool implementation.
- Produces an accurate public story, demo sequence, and repeatable model evidence.

- [ ] **Step 1: Update product and architecture copy**

  Explain the two-step outcome in plain language, distinguish verification from consent, remove every instruction to click Saved during the agent flow, and keep raw protocol terms inside Agent view/docs only.

- [ ] **Step 2: Re-export the exact 26 manifests and run targeted Luna-low cases**

  Re-run the three prior wording misses plus every new alert request/decision case. Fix ambiguous descriptions or schemas, not individual prompts.

- [ ] **Step 3: Run the 10 Terra-medium end-to-end workflows**

  Include search/compare, alert request/approval/decline/wrong code, application assistance, batched preparation, final review pending, external-role boundary, and workspace recovery. Record safe sequencing and exact human-decision boundaries.

- [ ] **Step 4: Run full release verification and commit evidence**

  Run: `pnpm verify`, disposable PostgreSQL 16 contract tests, the full WebMCP E2E suite, and `git diff --check`.

  Commit: `docs: prove agent-native monitoring`
