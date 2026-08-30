# Agent-first Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Jobbbler applications into an agent-prepared, one-review human experience while preserving exact consent, immutable review, and idempotent submission safeguards.

**Architecture:** Keep the existing owner-bound draft, delegation, data-grant, confirmation, and receipt records. Replace the visible four-step ceremony and low-level WebMCP lifecycle with a document-like final review, one explicit first-party submit action, outcome-oriented agent tools, and a compact activity receipt. Existing storage adapters remain authoritative; the client orchestrator resumes safely from any persisted stage.

**Tech Stack:** Next.js 15, React 19, TypeScript, Zod, Vitest, SQLite/PostgreSQL storage adapters, imperative WebMCP `document.modelContext.registerTool`.

**Spec:** `docs/superpowers/specs/2026-08-29-agent-first-application-design.md`

## Global Constraints

- Product and documentation copy stays in English.
- Every submitted application still requires an immutable reviewed payload and a fresh single-use human confirmation.
- External roles are never reported as submitted by Jobbbler.
- No private answers, credentials, tokens, email addresses, or raw identifiers appear in WebMCP results or Agent Activity.
- Every tool remains discoverable from every route, but tool names describe outcomes rather than internal lifecycle records.
- The browser-only fallback remains fully usable without WebMCP.

---

### Task 1: Truthful idempotent application start and activity receipt

**Files:**

- Modify: `apps/web/src/server/application-route-handlers.ts`
- Modify: `apps/web/src/server/applications.ts`
- Modify: `apps/web/src/features/application/start-application.ts`
- Modify: `apps/web/src/features/site-wide-webmcp-tools.ts`
- Modify: `apps/web/src/components/agent-activity-rail.tsx`
- Test: `apps/web/src/server/application-route-handlers.test.ts`
- Test: `apps/web/src/features/application/start-application.test.ts`
- Test: `apps/web/src/features/site-wide-webmcp-tools.test.ts`
- Test: `apps/web/src/components/agent-activity-rail.test.tsx`

**Interfaces:**

- Produces: `ApplicationStartResult = { draft: ApplicationDraft; disposition: "created" | "reopened" }` at the server boundary.
- Produces: `prepare_application(jobId)` result data with `draftId`, `href`, `disposition`, and `nextAction`.
- Produces: activity rows that group equivalent repeated calls and omit zero durations.

- [ ] **Step 1: Write failing tests for created versus reopened starts**

Assert that the first owner/job start publishes `Application draft created.` and the second returns the same draft with `Application draft reopened.`.

- [ ] **Step 2: Run the focused start tests and confirm RED**

Run: `pnpm vitest run apps/web/src/server/application-route-handlers.test.ts apps/web/src/features/application/start-application.test.ts apps/web/src/features/site-wide-webmcp-tools.test.ts`

- [ ] **Step 3: Return disposition from the application operation and WebMCP result**

Change the start operation to test `getByOwnerAndJob` once and return the existing draft as `reopened`; new inserts return `created`. Rename the public manifest from `start_application` to `prepare_application`, preserve navigation, and use truthful summaries.

- [ ] **Step 4: Collapse repeated receipt rows and align the tab count**

Group identical terminal calls independent of wall-clock spacing when they represent the same idempotent outcome, render `N calls`, omit non-positive durations, and use grouped count in the Activity tab label.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm vitest run apps/web/src/server/application-route-handlers.test.ts apps/web/src/features/application/start-application.test.ts apps/web/src/features/site-wide-webmcp-tools.test.ts apps/web/src/components/agent-activity-rail.test.tsx && pnpm --filter @jobbbler/web typecheck`

### Task 2: One document-like human review and submit action

**Files:**

- Modify: `apps/web/src/features/application/application-model.ts`
- Modify: `apps/web/src/features/application/application-view.tsx`
- Modify: `apps/web/src/features/application/application-view.module.css`
- Modify: `apps/web/src/features/application/application-workspace.tsx`
- Test: `apps/web/src/features/application/application-view.test.tsx`
- Test: `apps/web/src/features/application/application-model.test.ts`

**Interfaces:**

- Produces: `applicationReadiness(workspace)` with `completed`, `required`, `missingFieldKeys`, and `readyForReview` based on values, not per-field acceptance clicks.
- Produces: one UI action `review_and_submit` that resumes safely from `draft`, `valid`, `reviewed`, or `awaiting_confirmation`.

- [ ] **Step 1: Write failing rendering tests for the two-state journey**

Assert that an incomplete draft shows only missing questions and a disabled final action; a complete draft shows one `Review and submit` surface; no visible `Step 1 of 4`, `Permission`, delegation record, or separate confirmation action remains.

- [ ] **Step 2: Write failing orchestration tests for resume-safe finalization**

Cover draft → save accepted values → validate → review → request/approve disclosure → confirm → submit, plus resume from reviewed with an already-active grant.

- [ ] **Step 3: Replace the progress wizard and trust rail**

Render a concise role header, editable answer document, missing-item summary, exact recipient/data disclosure, one primary final action, optional pending agent-assistance request, and a truthful receipt. Keep technical audit facts inside one collapsed disclosure.

- [ ] **Step 4: Implement one-click resume-safe finalization**

Persist the visible values as human-confirmed, use returned versions for validation/review, reuse matching active grants, issue a fresh confirmation, submit with one idempotency key, and reload. On failure, retain the last persisted stage and present a retryable plain-language error.

- [ ] **Step 5: Run application tests and typecheck**

Run: `pnpm vitest run apps/web/src/features/application/application-model.test.ts apps/web/src/features/application/application-view.test.tsx apps/web/src/server/applications.integration.test.ts && pnpm --filter @jobbbler/web typecheck`

### Task 3: Outcome-oriented WebMCP application tools

**Files:**

- Modify: `apps/web/src/features/application/webmcp-tools.ts`
- Modify: `apps/web/src/features/application/webmcp-surface.ts`
- Modify: `apps/web/src/features/application/application-workspace.tsx`
- Modify: `apps/web/src/components/webmcp-registration.ts`
- Modify: `apps/web/src/components/webmcp-provider.tsx`
- Modify: `apps/web/src/lib/webmcp-catalog.ts`
- Modify: `apps/web/src/features/webmcp-workflows.ts`
- Test: `apps/web/src/features/application/webmcp-tools.test.ts`
- Test: `apps/web/src/features/webmcp-manifest-validation.test.ts`
- Test: `apps/web/src/features/webmcp-workflows.test.ts`

**Interfaces:**

- Produces: global tools `get_application_readiness`, `request_application_assistance`, `propose_application_updates`, `request_submission_review`, and `submit_application`.
- Removes public low-level tools `request_application_access`, `set_application_answer`, `validate_application`, `review_application`, `request_data_permission`, and `request_final_confirmation`.

- [ ] **Step 1: Write failing exact-inventory and state-gate tests**

Assert the reduced names, batch patch schema, safe readiness output, one human-interaction request, structured `NOT_FOUND`/`CONFLICT`, and no navigation for read-only calls.

- [ ] **Step 2: Implement batch proposal and readiness tools**

Accept at most 24 unique `{fieldKey, value}` patches, preserve `agent_suggestion` provenance, advance expected versions sequentially, and return only counts, missing field labels, stage, and next action.

- [ ] **Step 3: Implement the single submission-review request**

Return one `requires_user_action` presentation containing recipient, purpose, field labels, privacy notice, and a link to the owned review surface. It grants and submits nothing.

- [ ] **Step 4: Update catalog, workflow advisor, registration, and eval fixtures**

Make the recommended flow `prepare_application` → readiness → optional assistance → batch proposals → submission review → receipt. Remove every stale name and route-scoped claim.

- [ ] **Step 5: Run WebMCP tests and typecheck**

Run: `pnpm vitest run apps/web/src/features/application/webmcp-tools.test.ts apps/web/src/features/webmcp-manifest-validation.test.ts apps/web/src/features/webmcp-workflows.test.ts apps/web/src/features/webmcp-tools.test.ts && pnpm --filter @jobbbler/web typecheck`

### Task 4: Browser, accessibility, and failure-state verification

**Files:**

- Modify: `docs/design/audit-deep-2026-08-29/README.md`
- Modify: `docs/architecture/webmcp-capability-matrix.md`
- Modify: `docs/architecture/agent-authorization-and-consent.md`
- Modify: `docs/architecture/webmcp-evals.md`

**Interfaces:**

- Produces: accepted screenshots and an evidence-backed audit tied to exact filenames.
- Produces: architecture documentation matching the implemented global outcome-oriented surface.

- [ ] **Step 1: Exercise the live incomplete, complete, confirmation, receipt, and error states**

Use only the in-app browser. Capture CSS-scale screenshots at the same desktop viewport and inspect each image.

- [ ] **Step 2: Verify keyboard, focus, contrast, zoom, reduced-motion, and narrow layouts**

Use browser DOM/computed-style inspection for measurable checks and the in-app browser/CUA for visual states. Record limitations rather than claiming screenshot-only WCAG conformance.

- [ ] **Step 3: Execute every application WebMCP scenario**

Cover new draft, reopened draft, missing values, batch proposals, permission request, stale ID, wrong stage, expired confirmation, duplicate submission, external role, cancellation, and receipt readback.

- [ ] **Step 4: Update the audit and architecture docs**

Tie each finding to before/after evidence, record the remediation, and ensure no documentation claims route-scoped tools, cryptographic agent identity, or automatic external submission.

- [ ] **Step 5: Run the project verification gate**

Run: `pnpm verify`

Expected: formatting, lint, typecheck, unit/integration tests, build, migration checks, and WebMCP eval fixtures all pass.
