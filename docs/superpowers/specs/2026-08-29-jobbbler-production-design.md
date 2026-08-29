# Jobbbler Production Design

**Status:** Approved through delegated product authority  
**Date:** 2026-08-29  
**Product:** Jobbbler, the Jobs vertical of the Universal Discovery, Subscription, and Action Platform  
**Public release:** Jobs only; Local Services remains a future vertical on the same contracts

## 1. Outcome

Jobbbler is an agent-native job discovery and application workspace. A visitor can ask a compatible browser agent for a nuanced outcome, inspect and edit the deterministic filters that the agent applied, compare explainable results, schedule durable updates, and prepare a safe application without installing a separate MCP server.

The competition release must be a coherent production product, not a technical proof of concept. It must work as a conventional accessible web application without WebMCP and become substantially more efficient when a browser agent is present.

The release succeeds when:

- judges can use the public search without an account;
- ChatGPT's in-app browser discovers useful, route-relevant WebMCP tools;
- tool calls and human interactions mutate the same visible state;
- search, comparison, saved alerts, and a reviewed internal application form one complete story together;
- data provenance, uncertainty, agent activity, and safety boundaries are visible;
- light and dark themes, responsive layouts, and accessible keyboard flows are polished;
- local development uses SQLite and the production environment uses Supabase PostgreSQL through behaviorally equivalent repositories;
- the public repository, live URL, demo video, gallery assets, and Devpost submission are complete.

## 2. Product choice and alternatives

### Chosen: deep Jobs-first product on a reusable core

Build the Jobs vertical end to end, including discovery, monitoring, and one safe internal application path. Preserve clear core/domain/storage boundaries so Local Services can be added later without a conditional-heavy frontend.

This is the strongest option because it maximizes all four judging criteria: non-trivial WebMCP leverage, a complete experience, a specific real audience, and an ambitious but understandable human-agent collaboration story.

### Rejected: launch Jobs and Local Services together

This would demonstrate reuse but divide design, data, testing, and narrative quality across two products. The public experience would be shallower and the three-minute video would not explain either vertical well.

### Rejected: visually rich client-only showcase

A client-only demo would be faster but could not honestly demonstrate durable schedules, verified ownership, SQLite-to-Supabase migration, auditable actions, or production reliability.

## 3. Scope

### Competition release

- Public job search with deterministic text and structured filters.
- Natural-language intent accepted by `search_jobs`, compiled and validated server-side.
- Three source adapters with policy, attribution, freshness, and raw-record provenance.
- Canonical job records and version history with conservative duplicate resolution.
- Explainable ranking, unknown-value handling, exclusions, and fit dimensions.
- Job detail, save/hide, compare, and shareable URL state.
- Candidate demo profile and account-owned profile.
- Saved searches and durable daily or weekly schedules.
- Verified notification endpoint architecture and a real email provider adapter.
- Deterministic delta calculation and digest delivery.
- Internal demo-employer application with draft, provenance, validation, immutable review, short-lived single-use confirmation, idempotent submission, and receipt.
- External jobs use a prepared packet and honest URL handoff; Jobbbler never claims external success.
- Visible Agent Activity rail and a WebMCP availability inspector.
- Operator source-health view and auditable tool/action events.
- SQLite development database, export tool, Supabase import, PostgreSQL production adapter, RLS, and parity verification.
- CI, deployment, operational documentation, restore drill, public repository, license, demo assets, and Devpost submission.

### Explicitly out of scope

- Public Local Services UI, Overture import, quotes, or bookings.
- Bulk applications or scheduled applications.
- Employer-authorized ATS submissions.
- Arbitrary SQL, arbitrary URL fetches, or generic action tools.
- Semantic vectors before a lexical/structured relevance baseline.
- Billing, marketplace payments, chat, or recruiter pipeline management.

## 4. Experience design

### Brand and visual direction

The brand name is **Jobbbler**. The visual idea is “signal over noise”: editorial typography, calm neutral surfaces, sharp information hierarchy, and a restrained signal-green accent used only for agent state, verified provenance, and primary actions.

The interface must not resemble an unmodified component library. It uses a small proprietary token system and focused primitives.

Light theme:

- canvas: warm near-white;
- elevated surface: white;
- primary text: near-black with a slight green cast;
- secondary text: neutral olive-gray;
- signal: accessible saturated green;
- caution and destructive colors are separate semantic tokens.

Dark theme:

- canvas: deep charcoal-green;
- surfaces: slightly lighter neutral layers;
- text: warm off-white;
- signal: brighter green with contrast-safe text pairing.

Typography uses a self-hosted variable sans for UI and display, plus a compact monospaced face for evidence, tool names, timestamps, and filter syntax. Type scale, spacing, radii, shadows, motion, and density are tokens. Motion lasts 140–220 ms, communicates state changes, and respects `prefers-reduced-motion`.

### Primary workspace

The desktop search route has three coordinated regions:

1. A compact top bar with brand, WebMCP status, theme, saved work, and profile.
2. The search workspace with an outcome composer, editable filter chips, result count, sort, and a clean result list.
3. A collapsible Agent Activity rail that explains tool calls, safe parameters, duration, affected state, and next step.

Mobile uses one column. Filters and Agent Activity become bottom sheets with keyboard-accessible alternatives. The main search and current result remain visible without horizontal scrolling.

### Competition demo path

The first screen already contains useful jobs and one example outcome. Within fifteen seconds a judge can ask:

> Find senior product engineering roles that are remote in Europe, pay at least EUR 100k, and emphasize hands-on technical work. Exclude agencies.

The agent calls `search_jobs`; the UI animates only the changed filters and results. The judge can then compare three roles, inspect why each matched, activate a morning alert, and open an internal application whose review explicitly separates profile facts from agent suggestions.

### States and accessibility

Every asynchronous surface has designed loading, empty, partial, stale, rate-limited, offline, error, and retry states. Skeletons preserve geometry. Errors identify whether results are stale but usable.

Semantic HTML, landmarks, focus management, visible focus rings, form labels, contrast, reduced motion, keyboard reordering alternatives, live regions for agent updates, and screen-reader summaries target WCAG 2.2 AA.

## 5. Information architecture

- `/` — public search workspace.
- `/jobs/[jobId]` — job detail, evidence, fit, and application capability.
- `/compare` — side-by-side comparison driven by URL IDs.
- `/saved` — saved jobs and searches.
- `/saved/[savedSearchId]` — schedule, latest run, and deterministic delta.
- `/apply/[draftId]` — application draft, validation, review, confirmation, and receipt.
- `/activity` — durable user-visible activity and audit history.
- `/about/webmcp` — concise explanation and live list of available tools.
- `/admin/sources` — protected source health, policies, runs, and failures.
- `/auth/*` and signed guest-management routes — identity and endpoint verification.

## 6. WebMCP strategy

### Principles

- Imperative API with feature detection and progressive enhancement.
- One coherent application operation per tool.
- Static registration within a stable route state; lifecycle-scoped registration/unregistration across route and ownership changes.
- A small non-overlapping tool set per page.
- Names under 30 characters, descriptions under 500 characters, parameter descriptions under 150 characters, and individual output summaries under 1,500 characters.
- Read-only tools use `readOnlyHint`; source-backed or user-authored output uses `untrustedContentHint`.
- Same-origin exposure only. No cross-origin `exposedTo` in the competition release.
- Every execution propagates its abort signal to network work.
- Backend commands revalidate schema, authorization, version, rate limit, and idempotency.

### Route tool sets

Search route:

- `search_jobs`
- `refine_job_search`
- `get_current_search`
- `compare_jobs`
- `save_job`

Job detail:

- `get_job_details`
- `assess_job_fit`
- `save_job`
- `start_job_application`

Saved-search detail:

- `preview_job_alert`
- `schedule_job_alert`
- `get_latest_job_alert`
- `pause_job_alert`

Application route:

- `get_application_draft`
- `set_application_answer`
- `validate_application`
- `review_application`
- `request_app_confirmation`
- `submit_application`

Tool registration is driven by one route manifest. Each tool calls the same typed application command used by the human UI. Successful commands publish a client event that updates the relevant store, URL, focus target, toast, and Agent Activity record.

### Evaluations

Deterministic tests cover route registration, schema validation, annotations, cancellation, UI synchronization, authorization, optimistic conflict, idempotency, and unregistration. A small agent-eval dataset covers direct, paraphrased, and ambiguous requests and verifies tool choice and arguments against the complete route tool set.

## 7. Technical architecture

### Monorepo

Use a strict TypeScript `pnpm` workspace:

```text
apps/
  web/                 Next.js application and BFF
  worker/              ingestion, schedules, notifications, action work
packages/
  contracts/           Zod schemas and API/WebMCP contracts
  core-domain/         ownership, search, schedules, audit, work items
  jobs-domain/         jobs, fit, comparison, applications
  storage/             repository interfaces and shared mapping
  storage-sqlite/      SQLite, FTS5, migrations, export
  storage-postgres/    PostgreSQL/Supabase, FTS, RLS-aware access
  connectors/          source policy and job source adapters
  webmcp/              feature detection, manifests, registration, activity
  ui/                  tokens and accessible primitives
  testing/             builders, fixtures, fake clock, WebMCP harness
migrations/
  sqlite/
  postgres/
scripts/
docs/
```

The domain packages import no framework, browser, HTTP client, or database driver. Physical storage implements repository contracts. WebMCP contains no authorization decision. Server-only modules own secrets.

### Runtime

- Next.js App Router and React for SSR, route handlers, and client islands.
- Node.js worker with the same application-command packages.
- Zod for runtime contracts and generated JSON Schema inputs.
- Drizzle for migration/schema typing inside adapters; domain code sees repositories.
- SQLite with WAL, foreign keys, FTS5, busy timeout, short transactions, and one primary write lane.
- PostgreSQL/Supabase with RLS, full-text search, scheduled work, and service-role-only worker access.
- Tailwind used only as a token-aware styling compiler; primitives remain owned by the project.
- Vitest for domain/contracts, Playwright for browser journeys, and a small accessibility smoke suite.

### Command and transaction model

UI, WebMCP, workers, and HTTP handlers invoke typed application commands. A state-changing command transaction may validate state, mutate domain rows, write a work item, write an audit event, and persist an idempotency response. It never performs external HTTP, email, or source ingestion inside the transaction.

## 8. Data and search

### Essential records

- identities: users, guest owners, notification endpoints, signed management scopes;
- sources: source policies, source runs, immutable raw records, attribution;
- catalog: organizations, canonical jobs, versions, source links, locations, skills;
- discovery: saved searches, schedules, search runs, results, state, deltas, digests;
- candidate: profiles, experiences, skills, documents and provenance;
- actions: capabilities, drafts, answers, reviews, confirmation tokens, submissions;
- operations: work items, attempts, tool invocations, audit events, idempotency records.

IDs are generated application-side and remain unchanged during migration. Timestamps are UTC ISO values at boundaries and native timestamptz in PostgreSQL. Enums are validated strings. Mutable aggregates have integer versions.

### Source strategy

Implement Jobicy, Remote OK, and Arbeitnow adapters behind one connector contract. Each adapter has a checked-in source-policy record, conservative polling interval, timeout, bounded response size, attribution mapping, fixture contract tests, and circuit-breaking failure state. Search runs only against the local normalized catalog.

For reliable judging, a first-party synthetic demo catalog is always available and clearly labeled. Live sourced records supplement it; they never determine whether the primary demo path works.

### Search pipeline

1. Validate raw intent and structured criteria.
2. Compile versioned deterministic JSON filters and unresolved assumptions.
3. Apply hard filters, including explicit unknown-value policy.
4. Retrieve lexical candidates with SQLite FTS5 or PostgreSQL full-text search.
5. Calculate deterministic relevance and evidence dimensions.
6. Return score explanation, provenance, freshness, and caveats.

No LLM is required for authorization or hard filters. Optional model-assisted parsing may propose criteria, but the server validates and displays every proposal before it influences a consequential action.

## 9. Identity, alerts, and applications

Public search is anonymous. Saving durable work creates either an authenticated owner or a verified guest owner. Notification endpoints remain pending until verified. Signed management links are narrow, expiring, hashed at rest, and require re-verification before privilege expansion.

The local scheduler uses a fake-clock-testable recurrence service and lease-based work items. Production scheduling enqueues through Supabase/PostgreSQL and workers claim with safe locking. Delivery keys prevent duplicate digests.

Internal application flow:

1. create owned draft for an internal demo-employer job;
2. map candidate facts with explicit provenance;
3. keep missing, sensitive, and suggested answers distinct;
4. validate against a versioned requirement schema;
5. create immutable review snapshot;
6. issue a short-lived confirmation token bound to owner, draft version, recipient, and payload hash;
7. consume the token once in an idempotent submission;
8. store a receipt and show the same final state in UI and tool output.

Any material edit invalidates review and confirmation. There is no bulk-submit tool.

## 10. Security and privacy

- Treat job descriptions, résumés, user text, and connector payloads as untrusted data.
- Sanitize rendered content; do not render source HTML.
- Strict CSP, secure headers, same-site cookies, origin checks, CSRF protection, and server-side authorization.
- Per-principal and per-IP rate limits with safe error envelopes.
- File type, size, magic-byte, and malware-scan adapter gates before document use.
- Secrets only in server/worker environments; no backend key in browser bundles.
- Supabase exposed tables deny by default and require explicit RLS policies.
- Audit consequential tool calls, ownership changes, reviews, confirmations, submissions, and operator actions.
- Minimize profile data sent to any optional AI provider and retain purpose/provenance metadata.
- Document retention, account deletion, source retention, security reporting, and incident response.

## 11. Reliability, observability, and operations

- Structured JSON logs with request, command, work item, source run, and tool invocation IDs.
- Health and readiness endpoints distinguish web, database, migrations, and worker state.
- Metrics for API latency/error rate, WebMCP success, search latency, connector freshness, queue age, schedule lateness, delivery success, SQLite contention, and action outcomes.
- Bounded retries with jitter, terminal error classes, expired-lease repair, and source isolation.
- SQLite off-host backup and automated restore verification before migration.
- PostgreSQL migration rehearses snapshot, validates row counts/IDs/checksums, switches adapters, and documents rollback.
- Production smoke checks cover public UI, search API, WebMCP discovery, one read tool, one safe mutation, auth boundary, and scheduler heartbeat.

## 12. Testing strategy

Testing is proportional to risk:

- unit tests for DSL compilation, unknown values, ranking, recurrence, deltas, confirmation tokens, and state machines;
- repository contract tests run against SQLite and PostgreSQL;
- connector fixture tests for normalization, attribution, policy, rate limit, and malformed payloads;
- WebMCP deterministic lifecycle and activity-state tests;
- Playwright journeys for search/compare, guest alert, application review/submit, theme, mobile, and no-WebMCP fallback;
- a compact accessibility scan on critical routes;
- migration parity and backup/restore checks;
- manual final validation in ChatGPT's in-app browser and Chrome with WebMCP enabled.

Snapshot-heavy tests and exhaustive component tests are avoided. Critical domain invariants and public journeys are release gates.

## 13. Delivery and submission

The repository starts with a baseline commit during the hackathon period and keeps meaningful dated commits. It includes an MIT license, complete README, environment example, architecture, source policy, security, deployment, testing, and demo instructions.

The live release is public and free through the judging period. Production uses Supabase PostgreSQL; local setup defaults to SQLite. A seeded judge/demo account is documented only in Devpost testing instructions when needed.

Submission assets:

- 3:2 product thumbnail;
- 4–6 gallery images showing search, explainability, compare, alert, application review, and Agent Activity;
- public YouTube video under three minutes with audio, showing a working result in the first fifteen seconds;
- concise English project story covering inspiration, WebMCP fit, implementation, challenges, learning, impact, and safety;
- live URL, public repository URL, tested clients, stack tags, and honest testing instructions.

No Devpost plugin is installed. Devpost Resources and Local Knowledge provide research pointers; current behavior is verified against the live app and official sources before release.

## 14. Release gates

The project is complete only when all gates pass:

1. Product: every competition journey works in UI and through the relevant WebMCP tools.
2. Design: light/dark, desktop/mobile, empty/error/loading, reduced motion, and WCAG checks pass.
3. Data: three adapters, provenance, demo catalog, source policy, freshness, and dedupe are verified.
4. Safety: authorization, prompt-injection boundaries, idempotency, immutable review, single-use confirmation, and no bulk apply are verified.
5. Persistence: SQLite behavior, backup/restore, export, Supabase import, PostgreSQL parity, RLS, and rollback evidence exist.
6. Operations: CI, deployment, health, logs, metrics, scheduler, and smoke checks pass.
7. Browser: live WebMCP discovery and representative calls work in ChatGPT's in-app browser and enabled Chrome.
8. Submission: public repository/license, live URL, video, gallery, English copy, team state, form, and final rule checklist are complete.
