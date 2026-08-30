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

That setup is agent-native too. `request_search_alert` prepares the exact
criteria, recurrence, masked email destination, purpose, retention, and right
to withdraw, then sends a six-digit mailbox code. A compatible external agent
client presents that review through its own interaction UI and collects an
explicit decision. Only
`decide_search_alert` with the same expiring server request — and the code on
approval — activates the unchanged schedule. No Jobbbler page interaction or
account form is required; tool access alone is not approval.

The next time the agent asks, `get_latest_search_update` answers with only
what changed, not the full result list again: "Since the last check: three new
roles, one updated, two closed." The person hears the delta, decides in
seconds, and moves on.

## Trust: applying slows down on purpose

When the journey reaches an application, speed stops being the point.

- Before preparing a known role, an agent can call
  `get_job_application_capability` to read the ground rules: what Jobbbler may
  prepare, which decisions stay with the person, and whether the person must
  continue on the employer's website.
- Seven outcome-oriented application tools are discoverable from every page and
  state-gated at execution: each answers with the next safe step when its
  moment has not arrived. Agent-prepared answers keep their provenance. Once
  assistance is requested or an agent suggestion exists, the site renders the
  draft read-only and revisions stay in the external agent client.
- Sharing reviewed data requires explicit permission bound to the exact
  reviewed payload, recipient, purpose, fields, and notice — permission
  applies only to this exact application. The visible owner review surface
  presents every exact value and sensitivity marker. The WebMCP JSON result
  carries only a compact request-bound reference with recipient, purpose,
  counts, notice, draft version, expiry, and review URL. A compatible agent
  client may show or observe the current owner-review page before relaying the
  explicit decision. The server accepts only the exact live request ID and
  draft version and stores the decision channel as request-bound evidence. It
  verifies that exact request and unchanged review, not the person's identity.
- The person can withdraw consent through the same agent interface in one tool
  call. Future consent-based processing stops immediately; any lawful
  historical submission receipt remains intact.
- Submission needs a fresh, short-lived, single-use confirmation, and the
  sealed payload cannot change between the person's review and the submit.
- External roles open an available validated HTTPS employer page; if none is
  available, the workflow stops. Jobbbler creates no draft, receipt, handoff
  record, or submitted claim for them.

## The technology — for judges

> Not an AI job board. A proof that any data-rich website can become safely
> operable by an external browser agent — without a separate MCP server,
> without hiding what changed, and without confusing tool access with human
> authority.

> Jobbbler does not only expose tools. It also teaches a visiting agent the
> safest useful path through them—without executing the plan or granting
> authority.

Jobbbler registers 26 focused WebMCP tools directly in the page. The same set
stays discoverable on every page, so an agent never loses a capability by
navigating. Private and workflow-specific tools are state-gated at execution —
when their required ID, ownership, or stage is not ready they return a clear
next step instead of pretending to succeed. The visible interface and WebMCP are
two adapters over the same server commands, so the URL, filters, results,
alerts, permissions, and receipts stay consistent whether a person or an agent
acted.

The imperative WebMCP API does not standardize a native consent UI or provide
cryptographic proof that a tool decision came from an agent or a human. A
compatible client may use its own interaction UI and may show or observe the
current Jobbbler tab. Jobbbler binds explicit client-supplied decisions to live
server requests without claiming identity proof.

`plan_job_workflow` is an optional advisory tool. It returns recommended safe
steps for the agent's current Jobbbler context and is advisory only — it plans, it
never acts. The global Agent layer makes the same story visible to people in a
plain hierarchy: Activity shows what happened, Tools groups the discoverable
capabilities, and Guide explains how to begin from an external agent client.
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
GBP, CAD at pinned rates) with human-readable evidence strings. All 26 focused
WebMCP tools are registered on every page and gate private or state-specific
behavior at execution time.

WebMCP capability is live while the page is open; durable alerts are an honest
server-side continuation, not a claim that the browser agent remains alive.
Alerts evaluate saved-search changes deterministically, queue idempotent
deliveries, and require a verified email endpoint. The request/decision pair
binds the person's external-client decision to one exact alert policy and
mailbox challenge. The first visit needs no account at all: a loginless private
owner session with passwordless email recovery.

The application flow is agent-first with request-bound human decisions. The
agent checks readiness, calls `request_application_assistance`, and waits while
the external agent client presents the request. Only
`decide_application_assistance` with the person's decision and the exact live
request ID can enable short-lived, draft-bound assistance; the same tool can
withdraw that active authority only for the exact bound request. The agent can
then propose truthful answers in bounded batches and request one exact
submission review. The exact field values and sensitivity markers stay on the
visible owner review surface. `request_submission_review` returns a compact
request-bound reference with the review URL, recipient, purpose, field and
sensitivity counts, privacy-notice version, draft version, and expiry; its
operational result remains within 1.5 KB. The external agent client relays the
person's decision against that reference. The server accepts a submission
decision only when it is bound to the exact request ID and draft version,
rechecks the unchanged review snapshot, seals the reviewed payload, and
consumes a short-lived single-use confirmation for the idempotent submit. The
stored consent receipt records the decision channel as evidence and
deliberately proves the request and server state, not cryptographic human
identity. Raw chat, reusable credentials, and exact application values stay
out of WebMCP JSON results. Stored consent evidence represents those values with
field keys and a review hash, not the raw values. The same global tool surface
lets the person withdraw that consent in one call; future consent-based
processing stops while historical submission receipts remain honest.

A purely manual internal draft can still finish in the first-party UI. Once
assistance is requested or an agent-suggested answer exists, the site offers no
local editing, approval, consent, or submission bypass; server routes require
revisions and those decisions to be relayed through the external agent client.
Pending data grants are reused only for the same decision channel and exact
request; an incompatible pending grant is withdrawn and replaced.

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

- A real WebMCP surface: 26 focused tools for job, comparison, saved-search,
  and application work — all discoverable from any page, each honest about
  when its prerequisites have not arrived.
- A zero-configuration website encounter: the agent opens Jobbbler and
  discovers the site's actions without a separate MCP-server declaration.
- An advisory planner (`plan_job_workflow`) and self-describing filters
  (`get_search_filters`) that let an agent compose valid actions instead of
  guessing.
- A delta channel (`get_latest_search_update`) that reports only what changed
  since the last check, backed by a worker that keeps running after the tab
  closes.
- An agent-native alert activation pair that combines an exact consent review,
  mailbox verification, idempotent scheduling, and no required site touch.
- Capability negotiation (`get_job_application_capability`) that states up
  front what an agent may prepare and what stays human.
- Search, comparison, saved alerts, and an internal demo application form
  connect into one coherent journey.
- The global Agent layer — Activity, Tools, and Guide — makes tool work
  understandable without turning the portal into a developer console.
- Progressive identity and verified-email alerts preserve a low-friction start
  while supporting durable ownership.
- Request-bound consent receipts connect the agent-client decision to an exact
  server record without overstating identity assurance.
- Explicit delegation, immutable review, and one-time confirmation keep
  internal application actions controlled. External roles continue on an
  available validated HTTPS employer page without a Jobbbler draft or receipt;
  if no validated page is available, the workflow stops.
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
- WebMCP registration code: https://github.com/der-bear/jobbbler/blob/main/packages/webmcp/src/register.ts
- WebMCP capability notes: https://github.com/der-bear/jobbbler/blob/main/docs/architecture/webmcp-capability-matrix.md

## Privacy and safety

Jobbbler starts without a public profile. Email alerts use verified endpoints;
encrypted email envelopes are decrypted only server-side for delivery. WebMCP
registration and a draft identifier do not grant an agent permission to act.
Delegation is resource-scoped and revocable. Data grants bind the owner
session, agent session, reviewed payload, recipient, purpose, fields, notice,
request ID, channel, and affirmative action; no raw chat is retained. An
application still needs review plus a short-lived single-use confirmation.
Tool activity and safe errors avoid raw PII, secrets, reusable tokens, and raw
source HTML. Operational WebMCP results stay within 1.5 KB; only the advisory
`plan_job_workflow` result may use up to 2 KB. The final-review result carries a
compact request-bound reference and counts, while exact synthetic application
values and sensitivity markers stay on the visible owner review surface.

## Open source and local run

License and public repository: [MIT-licensed Jobbbler source](https://github.com/der-bear/jobbbler).

Local run instructions: [README](https://github.com/der-bear/jobbbler#run-locally).
