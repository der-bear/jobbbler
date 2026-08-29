# Devpost copy — Jobbbler

## Project name

Jobbbler

## Tagline

Find once. Stay updated. Apply with control.

## The problem

Job search is repetitive. People rerun the same expensive search every day:
scan new listings, rebuild the same filters, compare incomplete facts, try to
remember what changed, and still risk missing the one meaningful change — a
new role, a salary revision, a posting that quietly closed. Conventional
automation hides context or requires custom integrations. People need an agent
to do the repetitive work across a data-rich platform without surrendering
their identity, application data, or final decision.

## The solution

Describe the search once, in plain words, to a compatible browser agent. The
agent opens Jobbbler — a complete, conventional job portal that works fine
without any agent — and discovers what the site can do on its own. No separate
MCP server is installed or declared.

The site describes itself instead of making the agent guess. Its global Agent
layer is available from every page, so an agent can safely start a search,
open a role, or navigate to the relevant workspace before it uses contextual
tools. The agent reads the accepted filter vocabulary through
`get_search_filters`, composes a valid search with `search_jobs`, and the
visible URL, filters, and results update on the real page. The search is saved
once; after the tab closes, Jobbbler's own server keeps checking on schedule —
an honest server-side continuation, not a claim that the browser agent remains
alive.

The next time the agent asks, `get_latest_search_update` answers with only
what changed, not the full result list again: "Since the last check: three new
roles, one updated, two closed." The person hears the delta, decides in
seconds, and moves on.

## Trust: applying slows down on purpose

When the journey reaches an application, speed stops being the point.

- Before anything starts, `get_job_application_capability` negotiates the
  ground rules for this specific role: what the agent may prepare, what stays
  human, and whether the application finishes on the employer's website.
- Six outcome-oriented application tools are discoverable from every page and
  state-gated at execution: each answers with the next safe step when its
  moment has not arrived. Agent-prepared answers keep their provenance and
  stay editable until the person's final review.
- Sharing reviewed data requires explicit permission bound to the exact
  reviewed payload, recipient, purpose, fields, and notice — permission
  applies only to this exact application. The agent presents that request to
  the person; Jobbbler binds the recorded decision to the exact server-issued
  request ID and draft version and stores the decision channel as evidence,
  without claiming cryptographic identity.
- Submission needs a fresh, short-lived, single-use confirmation, and the
  sealed payload cannot change between the person's review and the submit.
- External roles end in an honest handoff (`handed_off`, never a fake
  `submitted`); Jobbbler never claims an external submission it cannot prove.

## The technology — for judges

> Not an AI job board. A proof that any data-rich website can become safely
> operable by an external browser agent — without a separate MCP server,
> without hiding what changed, and without confusing tool access with human
> authority.

Jobbbler registers 24 WebMCP tools directly in the page: seven stable,
site-wide core tools plus 17 contextual tools, all registered on every page so
an agent never loses a capability by navigating. Contextual tools are
state-gated at execution — when their page or workflow state is not ready they
return a clear next step instead of failing. The visible interface and WebMCP are
two adapters over the same server commands, so the URL, filters, results,
alerts, permissions, and receipts stay consistent whether a person or an agent
acted.

`plan_job_workflow` is part of that stable core. It returns recommended safe
steps toward a goal from the current page and is advisory only — it plans, it
never acts. The global Agent layer makes the same story visible to people in a
plain hierarchy: Guide explains how to begin, Activity shows what happened,
and Tools separates the seven always-available tools from context-specific ones.
`get_search_state` also makes bounded output honest by explicitly reporting
when criteria have been omitted or shortened.

## Inspiration

WebMCP is an important step toward an agentic web in which a website can
explain its useful actions directly to the visiting browser agent. We chose
jobs because the value is immediately understandable: the data changes daily,
the search is repetitive, and the path from discovery to application contains
meaningful trust boundaries. Jobbbler is one concrete example of a broader
pattern that can apply to knowledge bases, marketplaces, and other data-rich
products.

## How we built it

Jobbbler is a TypeScript monorepo with a Next.js web app, domain packages,
portable SQLite/PostgreSQL storage adapters, connector workers, and an
accessible shared UI system. Its catalog normalizes policy-controlled job
records, retains source evidence, and ranks salaries currency-aware (EUR, USD,
GBP, CAD at pinned rates) with human-readable evidence strings. All 24 WebMCP
tools are registered on every page — a seven-tool stable core plus contextual
tools that gate themselves on route and workflow state at execution time.

WebMCP capability is live while the page is open; durable alerts are an honest
server-side continuation, not a claim that the browser agent remains alive.
Alerts evaluate saved-search changes deterministically, queue idempotent
deliveries, and require a verified email endpoint — and the first visit needs
no account at all: a loginless private owner session with passwordless email
recovery.

The application flow is agent-first with one human review: the agent checks
readiness, asks once for short-lived draft-bound assistance, proposes truthful
answers in bounded batches, and then presents one exact submission review —
recipient, purpose, fields, and privacy notice. The person decides in their
agent client or on the private review page; either way the server accepts the
decision only when it is bound to the exact request ID and draft version,
seals the reviewed payload, and issues a single-use confirmation before the
idempotent submit. The stored consent receipt records the decision channel as
evidence and deliberately does not claim cryptographic human identity.
Sensitive values and raw chat stay out of tool results and stored consent
evidence.

## Challenges we ran into

- Making browser-agent help meaningful without making WebMCP a decorative
  wrapper around ordinary endpoints.
- Keeping the app useful when WebMCP is unavailable, still preparing, or fails
  to register.
- Separating a helpful agent suggestion from authorization to read data,
  mutate a draft, or submit an application.
- Building alert scheduling, retries, and delivery identity so a refresh or
  worker retry does not produce duplicate notifications.
- Showing operational truth in a compact Agent panel without exposing
  identifiers, email addresses, raw source payloads, or secrets.

## Accomplishments we are proud of

- A real WebMCP surface: a seven-tool stable core and 17 contextual tools for
  job, comparison, saved-search, and application work — all reachable from any
  page, each honest about when its moment has not arrived.
- A zero-configuration website encounter: the agent opens Jobbbler and
  discovers the active page's actions without a separate MCP-server
  declaration.
- An advisory planner (`plan_job_workflow`) and self-describing filters
  (`get_search_filters`) that let an agent compose valid actions instead of
  guessing.
- A delta channel (`get_latest_search_update`) that reports only what changed
  since the last check, backed by a worker that keeps running after the tab
  closes.
- Capability negotiation (`get_job_application_capability`) that states up
  front what an agent may prepare and what stays human.
- Search, comparison, saved alerts, and an internal demo application form
  connect into one coherent journey.
- The global Agent layer — Guide, Activity, and Tools — makes tool work
  understandable without turning the portal into a developer console.
- Progressive identity and verified-email alerts preserve a low-friction start
  while supporting durable ownership.
- Payload-bound first-party consent receipts connect the visible decision to
  an exact server record without overstating identity assurance.
- Explicit delegation, immutable review, and one-time confirmation keep final
  application actions controlled, and external roles end in an honest handoff.
- Source-aware job ingestion, safe normalized data, and focused
  domain/storage/worker tests create an auditable foundation.

## What we learned

Agent UX improves when a site exposes a small vocabulary of outcome-level
actions, makes their effects legible, and tells the agent how to compose them.
Small boundaries matter: browser capability is not authorization; WebMCP is
not a background worker; an agent request is not human approval; a saved search is not permission to notify an
unverified endpoint; and a reviewed application is not confirmation to submit.
A strong non-agent fallback makes WebMCP more credible because the tool layer
augments a working product rather than disguising a missing workflow.

## What’s next

- Observe production tool use and refine the tool vocabulary and workflow
  plans from real user requests.
- Broaden connector coverage under explicit source policies and freshness
  monitoring.
- Add more user-controlled alert channels after the same verification and
  consent model is in place.
- Continue testing WebMCP behavior across supported browser contexts and
  refine state gates from observed agent workflows.

## Technologies used

TypeScript, Next.js, React, WebMCP/browser model context, Zod, Vitest, pnpm
workspaces, SQLite, PostgreSQL/Supabase adapter, Node.js workers, AES-256-GCM
email envelopes, Resend-compatible email delivery, and a custom CSS token
system.

## Resources

- Live project: **[PRODUCTION_URL — replace before submission]**
- Demo video: **[VIDEO_URL — replace before submission]**
- Source repository: https://github.com/der-bear/jobbbler
- WebMCP capability notes: `docs/architecture/webmcp-capability-matrix.md`

## Privacy and safety

Jobbbler starts without a public profile. Email alerts use verified endpoints;
encrypted email envelopes are decrypted only server-side for delivery. WebMCP
registration and a draft identifier do not grant an agent permission to act.
Delegation is resource-scoped and revocable. Data grants bind the owner
session, agent session, reviewed payload, recipient, purpose, fields, notice,
request ID, channel, and affirmative action; no raw chat is retained. An
application still needs review plus a short-lived single-use confirmation.
Tool activity and safe errors avoid raw PII, secrets, reusable tokens, and raw
source HTML.

## Open source and local run

License and public repository: [MIT-licensed Jobbbler source](https://github.com/der-bear/jobbbler).

Local run instructions: [README](https://github.com/der-bear/jobbbler#run-locally).
