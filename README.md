# Jobbbler

[![CI](https://github.com/der-bear/jobbbler/actions/workflows/ci.yml/badge.svg)](https://github.com/der-bear/jobbbler/actions/workflows/ci.yml)

**Find once. Stay updated. Apply with control.**

Job search is repetitive. People rerun the same queries every day, rebuild the
same filters, and still risk missing the one meaningful change — a new role, a
salary revision, a posting that quietly closed.

Jobbbler answers that with a plain, typography-first job portal for technology
roles: search, filters, saved searches with optional email updates, and one
deliberate application at a time.
Describe what you want once, in plain words, to a compatible browser agent; the
agent runs the search on the real site, the server keeps checking after you
close the page, and the next answer contains only what changed. When it is time
to apply, the agent prepares the exact application and the external agent
client presents every value, recipient, and data-use term for one explicit
decision bound to that unchanged application. The ordinary site remains a
complete manual alternative and a readable record of what was submitted.

The technology that makes this possible is WebMCP — no separately installed or
declared MCP server. A global agent activity panel is available on every page:
the same 29 focused tools stay discoverable across navigation, while private
and workflow-specific actions enforce IDs, ownership, and state when executed.

> Not an AI job board. A proof that any data-rich website can become safely
> operable by an external browser agent — without a separate MCP server,
> without hiding what changed, and without confusing tool access with human
> authority.

Built for the OpenAI WebMCP Challenge.

Jobbbler deliberately makes no model call of its own. The visiting external
agent already understands the person's language and can draft text; the site
contributes the part a general agent cannot safely invent: typed live data,
deterministic filters, durable state, bounded actions, and server-enforced
authority. This keeps intelligence in the chosen client and product truth in
the product.

## Why it is different

- **Explainable discovery.** Structured criteria, source provenance, freshness,
  salary semantics, known limits, and search-fit evidence stay visible in the
  interface. Salary ranking is currency-aware (EUR, USD, GBP, and CAD at pinned
  rates) and explains itself with evidence strings.
- **Global agent activity.** Twenty-nine focused tools for search, roles,
  comparison, saved searches, optional updates, and applications — all
  registered on every page, so navigation never costs an agent a capability.
  State-gated tools answer with a clear next step when
  their moment has not arrived, and the site describes itself — an agent can
  read accepted filter vocabulary and request a safe workflow instead of
  guessing.
- **Observable agent work.** The agent activity panel uses a clear **Activity**,
  **Tools**, **Guide** hierarchy. It shows readiness, the current tools, and
  human-readable activity without taking over the normal portal. Every activity
  entry leads with a human sentence, followed by the tool name, status, and
  duration. On mobile, an "Agent activity" button opens the same layer. The
  normal UI remains usable if WebMCP is unavailable.
- **No-login first run.** No account required: an ephemeral private owner
  session lets someone start immediately. Adding a verified email is optional;
  it enables passwordless recovery of applications and saved searches without
  turning the first visit into an account wall or a submission requirement.
- **Independent authority layers.** Agent delegation, payload-bound data
  permission, immutable review, and single-use confirmation are separate
  server-enforced decisions. A purely manual application can finish in the
  first-party UI. Once assistance is requested or an agent suggestion exists,
  the agent presents assistance, consent, and submission decisions in the
  external agent client; the server rejects a first-party bypass and accepts
  only decisions bound to the exact server-issued request and draft version.
  Active assistance can be withdrawn through that same request-bound decision
  tool.
- **Truthful actions.** Every fictional-demo role supports Jobbbler-managed
  delivery and can produce an immutable receipt only after the exact
  request-bound decision. The server still fails closed for any unsupported
  application mode.
- **Durable automation.** Saved searches keep being checked after you close the
  page: a worker with leases, deterministic change detection, delivery
  idempotency, bounded retries, and verified encrypted email endpoints.

## Product tour

| Find once                                                                                                                          | Stay updated                                                                        | Apply with control                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Search and live filters — chips, multi-selects, and a minimum-salary selector — with every result opening as a readable role page. | Save the exact query; optionally add verified email updates; see only what changed. | Review one exact document-like application on the visible owner surface; the sealed payload submits exactly once after the bound decision.   |
| Evidence, trade-offs, and source freshness stay on the role page.                                                                  | Pause or resume checking without exposing an address or credential to WebMCP.       | Agent-prepared answers keep their provenance; assisted applications are read-only on the site and revised through the external agent client. |

## WebMCP surface

Jobbbler uses `document.modelContext.registerTool` with feature detection,
strict JSON schemas, stable global registration with state-gated execution,
cancellation propagation, explicit annotations, and concise JSON-serializable
results. A browser capability is never treated as identity or authorization.

> Jobbbler does not only expose tools. It also teaches a visiting agent the
> safest useful path through them—without executing the plan or granting
> authority.

`plan_job_workflow` returns recommended safe steps for a goal from the current
page. It is advisory only: it plans, it never acts.

The catalog has **29 focused tools**, all registered on every page. Nine are
clear entry points — `plan_job_workflow`, `get_search_filters`, `search_jobs`,
`open_job_details`, `prepare_application`, `get_applications`,
`open_jobbbler_page`, `enable_workspace_recovery`, and
`recover_jobbbler_workspace`. The
remaining tools are grouped below by the product area they operate on and
validate explicit IDs, ownership, and workflow state at execution time:

- Search `/`: `get_search_state` (including an explicit truncation summary for
  bounded criteria)
- Role `/jobs/:jobId`: `get_job_details`, `compare_jobs`
- Comparison `/compare`: `get_comparison`, `add_job_to_comparison`,
  `remove_job_from_comparison`
- Saved `/saved`: `get_saved_alerts`, `request_search_alert`,
  `decide_search_alert`, `set_job_alert_state`, `open_saved_search`, and
  `get_latest_search_update` (reads only what changed since the last check,
  not the full result list). Alert setup stays in the external agent client:
  one tool prepares the exact review and sends a mailbox code; the second
  accepts only an explicit request-bound decision and, on approval, that code.
  `enable_workspace_recovery` optionally verifies an email for the current
  private workspace without granting consent, submission approval, or an alert
  subscription. `recover_jobbbler_workspace` then keeps restoration in the same
  external agent client: one strict action accepts the verified email supplied
  by the person; the second accepts only its exact recovery ID and six-digit
  code. Neither response echoes the email or code or returns owner or session
  data.
- Application `/apply/:draftId`: eight outcome-oriented tools —
  `get_applications`, `get_application_readiness`, `request_application_assistance`,
  `decide_application_assistance`, `propose_application_updates`,
  `request_submission_review`, `decide_application_submission`, and
  `withdraw_application_consent` — each answering with the next safe step when
  its stage has not arrived

Operational actions and `plan_job_workflow` stay within 1.5 KB.
`get_applications` is an explicitly paged private index (10 by default, 20
maximum) bounded to 16 KB.
Readiness, activity, and safe-error results never expose an owner ID, candidate
answer, contact detail, reusable agent token, confirmation secret, raw email
destination, or ciphertext. After application-bound assistance is authorized,
`request_submission_review` freezes the exact application and returns a private,
request-bound review to that same agent client: every completed value with its
sensitivity marker, review URL, recipient, purpose, notice version, draft
version, and expiry. The client must present those exact values before asking
for the person's final decision; the review URL is an optional first-party
fallback. This intentionally private result has a dedicated 64 KB bound because
the values themselves are the object of the decision. Stored consent evidence
represents those values with field keys and a payload hash, not the raw values.
`request_search_alert` returns the masked destination,
exact policy, expiry, and an opaque request-bound continuation token. Neither
result returns a reusable credential or performs the final action.

The imperative WebMCP API standardizes neither a native consent UI nor
cryptographic agent/human identity proof. Jobbbler binds each explicit
client-supplied decision to the live server request and resource version without
claiming to prove who supplied it.

See the [actual `registerTool` implementation](packages/webmcp/src/register.ts),
the [WebMCP capability matrix](docs/architecture/webmcp-capability-matrix.md),
and the [authorization and consent design](docs/architecture/agent-authorization-and-consent.md).

## Architecture

```mermaid
flowchart LR
  Browser[React interface + global 29-tool WebMCP surface] --> API[Next.js BFF and command boundary]
  API --> Domain[Framework-free domain services]
  Domain --> Storage[Portable repository contracts]
  Storage --> SQLite[(SQLite local)]
  Storage --> Postgres[(Supabase PostgreSQL production)]
  Connectors[Disabled-by-default source connectors] --> Worker[Lease-based worker]
  Worker --> Domain
  API --> Activity[Sanitized owner activity projection]
  Activity --> Browser
```

The monorepo keeps contracts, domains, storage adapters, connectors, WebMCP
lifecycle, workers, UI primitives, and the Next.js application independent.
SQLite and PostgreSQL implement the same behavioral repository contracts.
The challenge release serves one deterministic 300-role fictional catalog;
live source policies are disabled. The connector boundary remains tested for
future governed deployments, and external network work stays outside database
transactions.

More detail: [architecture index](docs/architecture/README.md),
[source governance](docs/architecture/source-ingestion.md),
[realtime activity](docs/architecture/realtime-agent-activity.md), and
[SQLite-to-PostgreSQL migration runbook](docs/operations/postgres-cutover-and-rollback.md).

## Documentation

The [documentation index](docs/README.md) separates implemented architecture,
security and operations, challenge evidence, submission materials, and the
preserved source specification and rules. Useful starting points are the
[WebMCP evaluation evidence](docs/architecture/webmcp-evals.md),
[challenge compliance map](docs/hackathon-compliance.md), and
[design and accessibility QA contract](docs/design/qa.md).

## Run locally

Requirements: Node.js 24 and pnpm 11.19.0.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:seed
pnpm dev
```

Open the local URL printed by Next.js. Seeding restores the canonical 300-role,
30-company fictional catalog and does not contact an upstream provider. Live
source ingestion is disabled in every checked-in policy for this release.

SQLite is the zero-service development default. Set `DATABASE_URL` for
PostgreSQL/Supabase; the server selects the PostgreSQL adapter without
exposing that connection string to the browser. See
[.env.example](.env.example) for the complete runtime contract.

## Workers

```bash
# Run one bounded saved-search alert cycle
JOBBBLER_WORKER_MODE=alert_once pnpm dev:worker

# Run the recurring saved-search service
JOBBBLER_WORKER_MODE=alert_service pnpm dev:worker
```

Production also defaults to `alert_service` when no worker mode is provided.
Catalog and combined modes remain explicit operator tools and still cannot make
a source request while the checked-in source policies are disabled.

Local email delivery defaults to an explicit capture adapter. Production
delivery requires a configured provider, a verified owner endpoint, and
server-only encryption/provider keys.

## Verification

```bash
pnpm verify
```

The release gate covers formatting/lint, strict TypeScript, domain and storage
invariants, authorization races, connector policy, worker idempotency, API
bounds, WebMCP registration/lifecycle/output budgets, security headers, and
production builds. Browser QA evidence is recorded in
[docs/design/qa.md](docs/design/qa.md). Exact counts and production smoke
evidence are recorded only for the final published revision so this overview
does not drift while the release candidate changes.

## Security and privacy

- AES-256-GCM for recoverable email envelopes; HMAC/SHA-256 challenge and session-token hashes at rest
- HttpOnly, same-site, production-secure cookies
- Trusted-origin mutation checks and durable principal-scoped rate limits
- Streamed request-body byte caps and strict Zod validation
- Enumeration-resistant, single-use passwordless recovery that atomically revokes prior sessions
- Human-only, two-step private-data deletion with transactional storage-adapter parity
- Purpose/recipient/field/payload/notice-bound data grants
- Transactional compare-and-swap approval and single-use confirmation consumption
- Deny-by-default PostgreSQL RLS, production CSP/HSTS, structured redacted logs
- Untrusted source content never rendered as trusted HTML or treated as instructions

Please report vulnerabilities through the process in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Alex Derkach
