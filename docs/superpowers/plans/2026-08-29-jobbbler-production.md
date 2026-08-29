# Jobbbler Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Jobbbler as a polished, publicly deployed, production-ready WebMCP job discovery, alerting, and safe-application product, developed against SQLite and cut over to Supabase PostgreSQL for production.

**Architecture:** A strict TypeScript workspace separates the Next.js UI/BFF, worker, framework-free domains, runtime contracts, storage adapters, connectors, WebMCP lifecycle, and UI system. UI and WebMCP invoke the same application commands; external work is queued outside transactions. Human identity, agent delegation, data authorization, and action confirmation are independent server-enforced layers. Sanitized domain events stream to the UI over WebSocket without becoming a source of truth. SQLite and PostgreSQL implement the same repository contracts and run the same behavior suite.

**Tech Stack:** Node.js 24 LTS, pnpm 11.19.0, Next.js 16.3.3, React 19.2.8, TypeScript 6.0.3 strict, Tailwind CSS 4.3.3, Zod 4.4.3, Drizzle ORM 0.45.2, SQLite/FTS5, Supabase PostgreSQL, Vitest 4.1.11, Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-08-29-jobbbler-production-design.md`

## Global Constraints

- Public competition release is Jobbbler only and contains IT/adjacent-technology vacancies; Local Services is a separate future product and separate submission.
- Every repository artifact and every user-facing string is English-only.
- Public search works without an account and without WebMCP.
- WebMCP uses `document.modelContext.registerTool`, feature detection, route/state lifecycle, same-origin exposure, cancellation, and visible UI synchronization.
- WebMCP is not treated as proof of agent identity. Agent authority comes from a resource/action/expiry-bound server delegation approved on a trusted first-party surface; secrets never appear in tool input, output, URL state, logs, or model context.
- Consent and other data-processing authorizations are purpose-, recipient-, field-, payload-, and policy-version-bound, independently revocable where applicable, and collected by a clear first-party affirmative action rather than inferred from an agent call.
- WebSocket events make agent work observable in real time, but commands, repository state, authorization decisions, and reconnect catch-up remain authoritative.
- Tool names are at most 30 characters, descriptions at most 500 characters, parameter descriptions at most 150 characters, and output summaries at most 1,500 characters.
- Source/user content is untrusted; read-only and untrusted annotations are accurate.
- No bulk apply, scheduled apply, arbitrary SQL, arbitrary fetch, generic action, or false external-submission success.
- Every mutable aggregate uses optimistic versioning; every side effect uses idempotency; consequential actions are audited.
- SQLite enables WAL and foreign keys on every connection; no external call occurs inside a write transaction.
- Production uses Supabase PostgreSQL with deny-by-default RLS and no server secret in browser code.
- UI is English, responsive, WCAG 2.2 AA, light/dark, reduced-motion aware, and visually original.
- Tests focus on domain invariants, storage parity, WebMCP lifecycle, critical journeys, accessibility, migration, and release smoke checks.
- Public repository contains an MIT license and complete reproduction/deployment instructions.

## Planned File Map

```text
apps/web/                 routes, BFF handlers, providers, page composition
apps/worker/              connector, schedule, notification and action workers
packages/contracts/       shared Zod/JSON Schema/API contracts
packages/core-domain/     commands, ownership, scheduling, deltas, audit
packages/jobs-domain/     catalog, search, fit and application state machines
packages/storage/         repository interfaces and contract suites
packages/storage-sqlite/  SQLite connection, migrations, FTS5 and repositories
packages/storage-postgres/PostgreSQL connection, migrations and repositories
packages/connectors/      source policy and three job connectors
packages/webmcp/          tool manifests, registration lifecycle and activity
packages/ui/              tokens and accessible visual primitives
packages/testing/         builders, fixtures, fake clock and WebMCP harness
migrations/sqlite/        numbered SQLite migrations
migrations/postgres/      numbered PostgreSQL/Supabase migrations and RLS
scripts/                  seed, ingest, export/import, backup/restore and smoke
docs/                     architecture, security, sources, operations and demo
```

---

### Task 1: Reproducible Workspace and Release Skeleton

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, `.nvmrc`, `.env.example`
- Create: `tsconfig.base.json`, `eslint.config.mjs`, `prettier.config.mjs`, `vitest.config.ts`
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`
- Create: each `packages/*/package.json` and `tsconfig.json` from the planned file map
- Create: `LICENSE`, `README.md`, `SECURITY.md`, `.github/workflows/ci.yml`
- Verify: execute the real `lint`, `typecheck`, `test`, and `build` scripts from a clean install

**Interfaces:**

- Produces workspace scripts: `dev`, `dev:web`, `dev:worker`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `db:migrate`, `db:seed`, `verify`.
- Produces `@jobbbler/*` package names and TypeScript project references used by all later tasks.

- [x] **Step 1: Create root and package manifests with exact pinned dependencies**

Use exact versions listed in the plan header. Set `engines.node` to `>=24 <27` so Node.js 24 LTS is the production baseline while local Node.js 26 remains supported, `type: module`, `private: true`, and `packageManager: pnpm@11.19.0`.

- [x] **Step 2: Add strict shared TypeScript, lint, format, Vitest, and CI configuration**

Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and `noEmit`. CI runs install with frozen lockfile, lint, typecheck, tests, build, and artifact upload for Playwright reports.

- [x] **Step 3: Add license, environment contract, security policy, and boot README**

Document SQLite as the default, PostgreSQL via `DATABASE_URL`, public Supabase variables, server-only Supabase key, Resend adapter variables, and demo seed commands without committing secrets.

- [x] **Step 4: Install dependencies and verify the skeleton**

Run: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.  
Expected: every command exits 0 and produces no untracked generated secrets.

- [x] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc .nvmrc .env.example .prettierignore tsconfig.base.json eslint.config.mjs prettier.config.mjs vitest.config.ts apps packages docs LICENSE README.md SECURITY.md .github
git commit -m "chore: scaffold production workspace"
```

### Task 2: Contracts, Domain Primitives, and Command Boundary

**Files:**

- Create: `packages/contracts/src/search.ts`, `job.ts`, `schedule.ts`, `application.ts`, `api.ts`, `webmcp.ts`, `index.ts`
- Create: `packages/core-domain/src/result.ts`, `errors.ts`, `clock.ts`, `ids.ts`, `command.ts`, `events.ts`, `index.ts`
- Create: `packages/jobs-domain/src/job.ts`, `search-criteria.ts`, `ranking.ts`, `index.ts`
- Test: colocated `*.test.ts` files for schemas, criteria, and ranking

**Interfaces:**

- Produces `ApplicationCommand<TInput,TResult>` and `CommandContext`.
- Produces `jobSearchInputSchema`, `JobSearchCriteria`, `JobSummary`, `SearchJobsResult`, and standard API envelopes.
- Consumed by storage, HTTP, WebMCP, workers, and UI.

- [ ] **Step 1: Write failing schema and ranking tests**

```ts
it("keeps unknown salary distinct from below threshold", () => {
  expect(rankJob(job({ salaryMin: null }), criteria({ salaryMin: 100_000 })).salary).toBe(
    "unknown",
  );
  expect(rankJob(job({ salaryMin: 80_000 }), criteria({ salaryMin: 100_000 })).salary).toBe(
    "below",
  );
});
```

- [ ] **Step 2: Define shared schemas and stable error envelope**

```ts
export const apiErrorSchema = z.object({
  code: z.enum([
    "VALIDATION",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
    "RATE_LIMITED",
    "DEPENDENCY",
    "INTERNAL",
  ]),
  message: z.string(),
  requestId: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});
```

- [ ] **Step 3: Implement command and context interfaces**

```ts
export interface CommandContext {
  requestId: string;
  principal: {
    kind: "anonymous" | "guest" | "user" | "service";
    id?: string;
    roles: readonly string[];
  };
  agent?: {
    sessionId: string;
    delegationId?: string;
    verifiedClientId?: string;
  };
  clock: Clock;
  idempotencyKey?: string;
}

export interface ApplicationCommand<I, O> {
  readonly name: string;
  execute(context: CommandContext, input: I): Promise<O>;
}
```

- [ ] **Step 4: Implement deterministic criteria normalization and score explanation**

Normalize strings, currencies, work models, seniority, locations, exclusions, and unknown-value policy. Return dimension scores and evidence without LLM authorization.

- [ ] **Step 5: Run focused and workspace tests**

Run: `pnpm --filter @jobbbler/contracts test && pnpm --filter @jobbbler/jobs-domain test && pnpm typecheck`.  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts packages/core-domain packages/jobs-domain
git commit -m "feat: define typed domain and command contracts"
```

### Task 3: SQLite Schema, Repositories, Seed, and Recovery

**Files:**

- Create: `packages/storage/src/repositories/*.ts`, `contract-tests/*.ts`, `index.ts`
- Create: `packages/storage-sqlite/src/connection.ts`, `migrate.ts`, `repositories/*.ts`, `fts.ts`, `index.ts`
- Create: `migrations/sqlite/0001_core.sql`, `0002_jobs.sql`, `0003_search.sql`, `0004_actions.sql`, `0005_fts.sql`
- Create: `scripts/seed-sqlite.ts`, `scripts/backup-sqlite.ts`, `scripts/restore-verify-sqlite.ts`
- Create: `packages/testing/src/builders.ts`, `fixtures/demo-catalog.json`
- Test: SQLite repository contracts, migration, FTS, WAL/FK, backup/restore

**Interfaces:**

- Produces repositories for catalog, saved search, schedules, applications, work items, audit, and idempotency.
- Produces `createSqliteStorage(databasePath): Storage`.

- [ ] **Step 1: Write the repository behavior suite before adapters**

```ts
export function savedSearchRepositoryContract(create: StorageFactory) {
  it("rejects stale expectedVersion", async () => {
    const storage = await create();
    const saved = await storage.savedSearches.insert(savedSearch());
    await storage.savedSearches.update({ ...saved, name: "A" }, saved.version);
    await expect(
      storage.savedSearches.update({ ...saved, name: "B" }, saved.version),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
}
```

- [ ] **Step 2: Add portable SQL migrations and migration journal**

Create typed base/vertical tables from the design, indexes, foreign keys, check constraints, versions, unique idempotency keys, token hashes, and immutable review/submission records.

- [ ] **Step 3: Enforce SQLite operational rules at connection time**

Run `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout = 5000`, and verify the returned values. Keep one application write queue and short `BEGIN IMMEDIATE` claims.

- [ ] **Step 4: Implement repositories and FTS5 search**

Keep SQLite SQL inside this adapter. Map rows to domain records. Implement lexical query escaping, structured filters, stable sort, pagination, and evidence joins.

- [ ] **Step 5: Seed a first-party synthetic catalog**

Seed at least 36 IT/adjacent-tech jobs across twelve fictional organizations, multiple regions, work models, seniority, compensation-known/unknown, and one internal demo employer. Cover engineering, data/AI, product, design/research, security, infrastructure, QA, developer relations, technical support/success, technical recruiting, and technology-focused operations or sales. Include deterministic timestamps and source attribution labeled `jobbbler_demo`.

- [ ] **Step 6: Test backup and restore**

Run migrations and seed, take an online backup, restore to a fresh temporary database, run integrity/FTS checks, and compare canonical IDs/counts/checksums.

- [ ] **Step 7: Run tests and commit**

```bash
pnpm --filter @jobbbler/storage-sqlite test
pnpm db:migrate
pnpm db:seed
pnpm db:restore-verify
git add packages/storage packages/storage-sqlite packages/testing migrations/sqlite scripts fixtures
git commit -m "feat: add portable SQLite persistence"
```

### Task 4: Source Policy, Three Connectors, and Ingestion

**Files:**

- Create: `packages/connectors/src/contracts.ts`, `policy.ts`, `runtime.ts`, `normalize.ts`
- Create: `packages/connectors/src/jobicy/*`, `remoteok/*`, `arbeitnow/*`
- Create: `packages/connectors/source-policies/*.json`
- Create: `apps/worker/src/ingest.ts`, `work-loop.ts`, `main.ts`
- Create: `fixtures/connectors/{jobicy,remoteok,arbeitnow}/*.json`
- Test: connector contract, malformed input, policy, dedupe, timeout and idempotent ingestion

**Interfaces:**

- Consumes `Storage`, job contracts, clock, and source policies.
- Produces `JobConnector.fetchPartition(input, signal): AsyncIterable<RawSourceRecord>` and `runSourceIngestion`.

- [ ] **Step 1: Write connector contract tests using checked-in fixtures**

Verify stable external IDs, source URL, attribution, raw hash, compensation uncertainty, location/work model, content sanitization, bounded records, and abort propagation.

- [ ] **Step 2: Implement executable source-policy validation**

Policies define enabled state, allowed purpose, minimum poll interval, request timeout, maximum bytes/records, attribution, retention, redistribution, and terms/source URLs. Runtime blocks a fetch when policy disallows it.

- [ ] **Step 3: Implement Jobicy, Remote OK, and Arbeitnow adapters**

Use official endpoints only, descriptive user agent, conservative cadence, conditional requests when supported, hard response bounds, and typed dependency errors. Never infer application permission from listing access.

- [ ] **Step 4: Implement normalization, conservative identity linking, and version creation**

Store immutable raw records first. Map only IT/adjacent-tech records into the supported taxonomy. Match by trusted source ID, canonical apply URL, or high-confidence organization/title/location evidence; ambiguous candidates remain separate.

- [ ] **Step 5: Implement lease-based worker execution**

Claim bounded work, make external calls outside write transactions, persist result/idempotency/audit, retry only transient errors with jitter, and isolate each source.

- [ ] **Step 6: Run connector and ingestion tests; ingest a bounded local sample**

Run: `pnpm --filter @jobbbler/connectors test && pnpm --filter @jobbbler/worker test && pnpm ingest -- --source all --limit 50`.  
Expected: connector tests pass; each enabled source records attribution and a completed/precisely failed run without breaking demo data.

- [ ] **Step 7: Commit**

```bash
git add packages/connectors apps/worker fixtures/connectors
git commit -m "feat: ingest and normalize policy-bound job feeds"
```

### Task 5: Search Commands, BFF, and Shareable State

**Files:**

- Create: `packages/jobs-domain/src/search-jobs-command.ts`, `compare-jobs-command.ts`, `fit.ts`
- Create: `apps/web/src/server/context.ts`, `commands.ts`, `rate-limit.ts`, `api-response.ts`
- Create: `apps/web/src/app/api/v1/jobs/search/route.ts`, `jobs/[id]/route.ts`, `jobs/compare/route.ts`
- Create: `apps/web/src/lib/search-url.ts`, `query-client.ts`
- Test: command tests, route tests, URL round trip, rate limit and untrusted output

**Interfaces:**

- Produces `searchJobsCommand.execute(context, SearchJobsInput): Promise<SearchJobsResult>`.
- Produces versioned `/api/v1` endpoints consumed by UI and WebMCP.

- [ ] **Step 1: Write failing command and URL round-trip tests**

Cover hard salary filters, explicit unknown policy, exclusions, pagination, stable ordering, evidence, and round-tripping visible filters through URL search params.

- [ ] **Step 2: Implement search, detail, fit, and comparison commands**

Authorize public reads, apply schema validation, call repositories, calculate deterministic score explanations, and cap untrusted descriptions in responses.

- [ ] **Step 3: Implement BFF routes and error/rate-limit envelope**

Generate request IDs, parse Zod input, never expose stack traces, set cache policy by endpoint, and return `429` with safe retry guidance.

- [ ] **Step 4: Run focused route and domain tests**

Run: `pnpm --filter @jobbbler/jobs-domain test && pnpm --filter @jobbbler/web test -- search`.  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/jobs-domain apps/web/src/server apps/web/src/app/api apps/web/src/lib
git commit -m "feat: expose explainable job discovery API"
```

### Task 6: Original Design System and Public Search Experience

**Files:**

- Create: `packages/ui/src/styles/tokens.css`, `base.css`, `motion.css`
- Create: `packages/ui/src/components/{button,input,chip,card,dialog,sheet,toast,skeleton,theme-toggle}.tsx`
- Create: `apps/web/src/app/layout.tsx`, `page.tsx`, `globals.css`, `providers.tsx`
- Create: `apps/web/src/features/search/*`, `job-card/*`, `job-detail/*`, `compare/*`
- Create: `apps/web/src/app/jobs/[jobId]/page.tsx`, `compare/page.tsx`, `about/webmcp/page.tsx`
- Test: component semantics, theme persistence, Playwright search/detail/compare/mobile/no-WebMCP

**Interfaces:**

- Consumes discovery API and URL state.
- Produces accessible UI primitives, search state store, and visible events consumed by WebMCP.

- [ ] **Step 1: Write Playwright acceptance tests from the visual design**

Assert public first render, keyboard search, editable filter chips, stable skeleton geometry, result evidence, three-job compare, light/dark persistence, 390px mobile behavior, reduced motion, and usable fallback with `document.modelContext` absent.

- [ ] **Step 2: Implement token system and primitives**

Implement warm neutral light, charcoal-green dark, contrast-safe signal accent, variable sans/mono typography, spacing/radius/shadow layers, focus rings, and reduced-motion overrides. Avoid copied shadcn markup or styling.

- [ ] **Step 3: Build search workspace and states**

Compose top bar, WebMCP status/pulse, outcome input, inferred/explicit filter chips, sort/count, list, result cards, point-of-effect change highlighting, accessible live announcements, empty/partial/stale/error states, and responsive sheets.

- [ ] **Step 4: Build details, evidence, fit and comparison**

Show source/freshness, known/unknown facts, responsibilities, salary semantics, match dimensions, tradeoffs, application mode, and URL-shareable compare selection.

- [ ] **Step 5: Run visual and accessibility tests**

Run: `pnpm --filter @jobbbler/web test && pnpm test:e2e --grep "search|theme|mobile|fallback"`.  
Expected: PASS at desktop and mobile viewports with no serious accessibility violations.

- [ ] **Step 6: Commit**

```bash
git add packages/ui apps/web/src/app apps/web/src/features
git commit -m "feat: create polished Jobbbler discovery experience"
```

### Task 7: WebMCP Lifecycle, Tools, Activity, and Evals

**Files:**

- Create: `packages/webmcp/src/types.ts`, `feature-detection.ts`, `manifest.ts`, `register.ts`, `activity.ts`, `json-schema.ts`
- Create: `apps/web/src/components/webmcp-provider.tsx`, `agent-activity-rail.tsx`, `webmcp-status.tsx`
- Create: `apps/web/src/features/*/webmcp-tools.ts`
- Create: `packages/testing/src/model-context-harness.ts`
- Create: `evals/webmcp/*.json`
- Test: lifecycle, schema, annotations, cancellation, same-state updates, route sets, direct/paraphrased/ambiguous evals

**Interfaces:**

- Produces `registerToolSet(manifest, context): () => void` and `AgentActivityStore`.
- Consumes the same typed command clients as human UI.

- [ ] **Step 1: Write a fake `document.modelContext` harness and failing lifecycle tests**

Test exact route tool names, unique purpose, abort-driven unregistration, cancellation propagation, feature absence, annotation accuracy, description/output budgets, and visible activity completion.

- [ ] **Step 2: Implement feature detection and static route manifests**

```ts
export interface ToolManifest<I, O> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(input: I, options: { signal: AbortSignal }): Promise<O>;
}
```

- [ ] **Step 3: Implement registration lifecycle with one `AbortController` per route set**

Register only when `document.modelContext?.registerTool` exists; abort on route/role/resource change; do not expose cross-origin tools; preserve in-flight behavior according to the current API and ensure network calls receive `signal`.

Before implementation, perform a focused current-documentation pass through Local Knowledge and the challenge's Devpost Resources. Record a capability-to-feature-to-test-to-demo matrix; do not assume WebMCP supplies a cryptographically verifiable agent identity unless the current API explicitly proves it.

- [ ] **Step 4: Implement route tools and UI synchronization**

Search, detail, compare, save, schedule, and application tools call versioned APIs, update the same client stores/URL as UI, focus a meaningful element, announce the outcome, highlight the affected state, and write concise activity records with confirmation and safe undo metadata.

- [ ] **Step 5: Implement deterministic tool/eval checks**

Validate complete route sets against direct, paraphrased, and ambiguous prompts; verify selected tool and structured arguments. Keep model-based evals non-blocking, deterministic lifecycle tests blocking.

- [ ] **Step 6: Test in local in-app browser and commit**

Run unit/integration tests, start local app, verify fetched tool list and representative read/mutation calls in ChatGPT's in-app browser, then:

```bash
git add packages/webmcp packages/testing apps/web/src/components apps/web/src/features evals
git commit -m "feat: add transparent route-scoped WebMCP tools"
```

### Task 8: Ownership, Saved Searches, Scheduler, and Email Alerts

**Files:**

- Create: `packages/core-domain/src/ownership/*`, `schedules/*`, `deltas/*`, `notifications/*`
- Create: `apps/web/src/app/api/v1/owners/*`, `saved-searches/*`, `schedules/*`
- Create: `apps/web/src/app/saved/page.tsx`, `saved/[savedSearchId]/page.tsx`, `manage/[token]/page.tsx`
- Create: `apps/worker/src/scheduler.ts`, `search-evaluator.ts`, `notification-worker.ts`
- Create: `packages/core-domain/src/notifications/resend-adapter.ts`, `capture-adapter.ts`
- Test: fake clock recurrence, guest verification, token scope/expiry, deltas, dedupe, retry and pages

**Interfaces:**

- Produces `SavedSearchService`, `ScheduleService`, `DeltaService`, `NotificationAdapter`.
- Produces APIs/tools for preview, schedule, latest update, pause, and management.

- [ ] **Step 1: Write state-machine tests with a fake clock**

Cover IANA timezone daily/weekly recurrence, DST, jitter, pause/resume, browser-closed execution, endpoint verification, narrow signed links, new/updated/closed/no-longer-matching deltas, delivery dedupe, and retry.

- [ ] **Step 2: Implement verified owner and management token flows**

Hash tokens at rest, bind scope/resource/expiry, rotate after use where applicable, and require re-verification for ownership expansion.

- [ ] **Step 3: Implement saved-search and schedule commands/APIs**

Preview exact filters, recurrence, timezone, threshold, endpoint, and update types before activation. Enforce optimistic version and idempotency.

- [ ] **Step 4: Implement scheduler, evaluator, delta, and notification workers**

Use leases, fake-clock-safe due calculation, deterministic digests, no-change suppression, delivery keys, bounded retries, and audit events. AI failure cannot block deterministic alerts.

- [ ] **Step 5: Build saved-search and signed management UI plus WebMCP tools**

Show next run, freshness, latest delta, pause/resume, delivery state, and exact changes. Tool activity updates the same UI.

- [ ] **Step 6: Verify a real provider in staging and commit**

Use the capture adapter locally and Resend only in configured staging/production. Verify one endpoint and one delivered digest without exposing credentials.

```bash
git add packages/core-domain apps/web/src/app apps/worker
git commit -m "feat: deliver durable verified job alerts"
```

### Task 9: Safe Internal Application State Machine

**Files:**

- Create: `packages/jobs-domain/src/applications/*`, `packages/core-domain/src/delegations/*`, `data-grants/*`
- Create: `apps/web/src/app/api/v1/applications/*`
- Create: `apps/web/src/app/apply/[draftId]/page.tsx`, `features/application/*`
- Create: `apps/worker/src/application-worker.ts`
- Test: progressive identity, agent delegation scope/expiry/revoke, data-grant purpose/recipient/payload binding, provenance, validation, review immutability, token binding/reuse/expiry, edit invalidation, idempotent submission, receipt, external handoff honesty

**Interfaces:**

- Produces `ApplicationService.start/setAnswer/validate/review/requestConfirmation/submit`.
- Produces `AgentDelegationService.request/approve/evaluate/revoke` and `DataGrantService.request/grant/withdraw/evaluate`.
- Produces application route WebMCP tools and a visible receipt.

- [ ] **Step 1: Write the application state-machine tests first**

```ts
it("invalidates confirmation after a material edit", async () => {
  const reviewed = await service.review(draftId, version);
  const token = await service.requestConfirmation(reviewed.id);
  await service.setAnswer(draftId, "motivation", "Changed", version);
  await expect(service.submit({ draftId, token })).rejects.toMatchObject({ code: "CONFLICT" });
});
```

- [ ] **Step 2: Implement versioned requirements, drafts, answers, and provenance**

Distinguish candidate facts, imported facts, user-entered answers, agent suggestions, unknowns, sensitive values, and declarations. Agent suggestions remain unreviewed until the user accepts/edits them.

- [ ] **Step 3: Implement immutable review and confirmation protocol**

Snapshot recipient, requirement version, fields, documents, declarations, payload hash, owner, and draft version. Store only a hash of the short-lived single-use token.

- [ ] **Step 4: Implement idempotent internal submission and external handoff**

Internal demo employer produces a durable receipt. External mode prepares a packet and opens the source URL but records only `handed_off`, never `submitted`.

- [ ] **Step 5: Build application UI and route-scoped WebMCP tools**

Show provenance and missing/sensitive fields, validation, exact review, confirmation expiry, submission progress, receipt, and safe retry. No bulk tool exists.

- [ ] **Step 6: Run security/journey tests and commit**

```bash
pnpm --filter @jobbbler/jobs-domain test -- applications
pnpm test:e2e --grep application
git add packages/jobs-domain apps/web apps/worker
git commit -m "feat: add reviewed single-application workflow"
```

### Task 10: PostgreSQL/Supabase Adapter, RLS, and Migration

**Files:**

- Create: `packages/storage-postgres/src/connection.ts`, `repositories/*.ts`, `fts.ts`, `index.ts`
- Create: `migrations/postgres/0001_core.sql` through `0005_rls.sql`
- Create: `scripts/export-sqlite.ts`, `import-postgres.ts`, `verify-migration.ts`, `rollback-migration.md`
- Test: shared repository contracts on PostgreSQL, RLS matrix, FTS/geo fixture parity, migration IDs/counts/checksums

**Interfaces:**

- Produces `createPostgresStorage(databaseUrl): Storage` with behavior equivalent to SQLite.
- Consumed through `createStorage(env)` without domain changes.

- [ ] **Step 1: Run the existing repository contract suite against an empty PostgreSQL test database**

Expected initially: FAIL because PostgreSQL repositories do not exist.

- [ ] **Step 2: Add PostgreSQL schema, indexes, work claims, and repositories**

Use native `timestamptz`, JSONB where portable JSON is required, full-text indexes, safe `FOR UPDATE SKIP LOCKED` claims, and explicit transactions. Preserve application-generated IDs.

- [ ] **Step 3: Add deny-by-default RLS and policy tests**

Test anonymous public catalog reads, owner-only saved/profile/action rows, guest management scope, organization roles, and service-role worker access. Verify browser keys cannot bypass policies.

- [ ] **Step 4: Implement deterministic SQLite export and PostgreSQL import**

Export versioned newline-delimited JSON in dependency order with schema version/checksums. Import into staging, validate foreign keys, IDs, versions, row counts, search fixtures, guest management, applications, and audit continuity.

- [ ] **Step 5: Rehearse snapshot, cutover, and rollback**

Freeze local writes, export, import, verify, switch `DATABASE_DRIVER=postgres`, run smoke tests, and document the reverse switch before any post-cutover writes.

- [ ] **Step 6: Commit**

```bash
git add packages/storage-postgres migrations/postgres scripts
git commit -m "feat: migrate storage to Supabase PostgreSQL"
```

### Task 11: Security, Observability, CI, and Production Deployment

**Files:**

- Create/Modify: `apps/web/next.config.ts`, middleware/security modules, rate limits, health routes
- Create: `packages/core-domain/src/observability/*`, `docs/architecture.md`, `docs/security.md`, `docs/privacy.md`, `docs/sources.md`, `docs/operations.md`, `docs/deployment.md`
- Create: `Dockerfile`, `.dockerignore`, deployment provider config, `scripts/smoke-production.ts`
- Modify: `.github/workflows/ci.yml`; create deployment workflow if credentials support it
- Test: headers/CSP, authz, prompt-injection fixtures, health/readiness, log redaction, rate limit, production smoke

**Interfaces:**

- Produces `/api/health`, `/api/ready`, structured logs/metrics, hardened headers, deployment artifact, and runbooks.

- [ ] **Step 1: Write security and observability tests**

Cover CSP, frame/origin policy, secure cookies, CSRF/origin checks, human/agent/data/action authorization matrix, untrusted content sanitization, secret redaction, file gates, API bounds, WebSocket channel authorization and redaction, reconnect cursors, and request/tool/work correlation IDs.

- [ ] **Step 2: Implement security middleware and abuse controls**

Use server-side schema/auth checks for every tool API, same-site session cookies, mutation origin validation, resource-scoped agent delegations, purpose-bound data grants, principal/IP rate limits, bounded payloads, safe errors, and no raw source HTML.

- [ ] **Step 3: Implement health, logs, metrics, and worker heartbeat**

Readiness checks database/migrations; health does not depend on external feeds. Emit structured redacted events for API, WebMCP, source, scheduler, delivery, application, and migration operations. Stream a sanitized subset through a cursor-based WebSocket gateway with heartbeat, bounded buffers, reconnect catch-up, and a polling fallback; production may implement the same contract with Supabase Realtime.

- [ ] **Step 4: Complete operations and compliance documentation**

Document source obligations, retention/deletion, backup/restore, incident triage, RPO/RTO, secret rotation, connector disablement, migration rollback, and judging-period availability.

- [ ] **Step 5: Build and deploy production**

Create the Supabase project/schema, configure server/public keys and email provider, deploy web/worker/scheduler, seed/import data, bind the public domain, and leave no credentials in Git or client bundles.

- [ ] **Step 6: Run production smoke and commit**

```bash
pnpm verify
pnpm smoke:production -- --base-url "$PUBLIC_BASE_URL"
git add apps packages docs Dockerfile .dockerignore .github scripts
git commit -m "chore: harden and deploy Jobbbler production"
```

### Task 12: Browser, Accessibility, Performance, and Release Verification

**Files:**

- Create: `playwright.config.ts`, `tests/e2e/*.spec.ts`, `tests/a11y/*.spec.ts`, `tests/webmcp/*.spec.ts`
- Create: `docs/release-checklist.md`, `docs/test-evidence.md`
- Modify: defects found during verification only in their owning modules

**Interfaces:**

- Produces reproducible evidence for all release gates and live browser compatibility.

- [ ] **Step 1: Run full automated verification from a clean install**

Run install with frozen lockfile, migrations/seed, lint, typecheck, unit/contract, build, Playwright desktop/mobile, accessibility, migration parity, backup/restore, and production smoke.

- [ ] **Step 2: Validate local UI visually in light/dark and responsive sizes**

Inspect primary routes, all loading/empty/error/partial states, focus order, clipping, contrast, motion, screenshots, and console/network errors. Fix only evidence-backed defects.

- [ ] **Step 3: Validate local WebMCP in ChatGPT's in-app browser**

Verify exact route tools, annotations, search UI synchronization, compare, schedule preview/activation, application review/confirmation, cancellation, unregistration, activity, and fallback.

- [ ] **Step 4: Validate production independently**

Repeat critical UI/WebMCP calls against the live URL, verify public access, server-side persistence, scheduler after closing the tab, delivered digest, application receipt, RLS denial, and no secret/source-map leakage.

- [ ] **Step 5: Record evidence and commit fixes/docs**

```bash
git add tests playwright.config.ts docs apps packages
git commit -m "test: verify production journeys and WebMCP behavior"
```

### Task 13: Public Repository, Walkthrough Media, and Devpost Submission

**Files:**

- Modify: `README.md`, repository About metadata, final docs
- Create: `docs/demo-script.md`, `docs/devpost-story.md`, `docs/devpost-fields.md`
- Create: `assets/submission/thumbnail.png`, gallery images, video source/output and captions
- External: public Git host, live deployment, public YouTube video, Devpost draft/final submission

**Interfaces:**

- Consumes verified production behavior and produces the complete public judging package.

- [ ] **Step 1: Finalize public repository presentation**

README leads with value and a short working demo, then WebMCP tools, architecture, local SQLite start, Supabase production setup, tests, source policy, safety, screenshots, license, and dated hackathon work. Verify license detection and public access in a signed-out view.

- [ ] **Step 2: Write the under-three-minute storyboard and narration**

Show working agent search in the first fifteen seconds, then explain visible filters/evidence, compare, durable alert, reviewed application, Agent Activity, WebMCP architecture, and impact. Target 150–165 spoken words per minute and finish below 2:50.

- [ ] **Step 3: Record, edit, caption, and validate media**

Use the polished UI walkthrough workflow. Remove loading/dead air, use no copyrighted music or third-party marks without permission, include audio and English captions, export a public YouTube-compatible video, and verify the final file before upload.

- [ ] **Step 4: Produce thumbnail and gallery**

Create a 3:2 thumbnail and 4–6 3:2 images showing the outcome composer, explainable results, compare, alert, application review, and activity rail in the final visual system. Verify readable crop and file size under Devpost limits.

- [ ] **Step 5: Complete all Devpost fields as a draft**

Fill project name/elevator pitch/thumbnail, English story, stack tags, live and public repo links, gallery, public video, submitter type, residence, new-app status, testing instructions, tested clients, AI tools, learning, and career value. Save draft and re-open the public preview to verify rendering.

- [ ] **Step 6: Run the official final checklist**

Verify current rules/deadline, live WebMCP access, public repo/license, video/audio/duration, accurate story, team state, testing credentials, no restricted IP/PII, and judging-period availability.

- [ ] **Step 7: Commit submission source artifacts**

```bash
git add README.md docs assets/submission
git commit -m "docs: complete WebMCP Challenge submission package"
```

- [ ] **Step 8: Submit only after action-time confirmation**

At the finalization page, request the required action-time confirmation for the exact Devpost project and personal/representational data, accept the rules checkbox only after the user confirms, submit, and verify the authoritative submitted state.

## Plan Self-Review Result

- Every design release gate maps to Tasks 1–13.
- SQLite, PostgreSQL, UI, WebMCP, schedules, applications, security, deployment, media, and Devpost each have an independently reviewable deliverable.
- Shared interface names are consistent across tasks: `Storage`, `ApplicationCommand`, `CommandContext`, `ToolManifest`, `SavedSearchService`, `ScheduleService`, `ApplicationService`.
- The plan contains no deferred feature placeholders. Out-of-scope items remain explicitly excluded.
