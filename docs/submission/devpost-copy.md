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
to withdraw. A new destination receives a six-digit mailbox code; a destination
already verified for the same private owner does not. A compatible external
agent client presents that review through its own interaction UI and collects
an explicit decision. Only `decide_search_alert` with the same expiring server
request — plus the code when the review requires it — activates the unchanged
schedule. No Jobbbler page interaction or account form is required; tool access
alone is not approval.

The next time the agent asks, `get_latest_search_update` answers with only
what changed, not the full result list again: "Since the last check: three new
roles, one updated, two closed." The person hears the delta, decides in
seconds, and moves on.

## Trust: applying slows down on purpose

When the journey reaches an application, speed stops being the point.

- `prepare_application` directly creates or reopens one private Jobbbler
  application for the chosen role without using personal data or submitting it.
- Seven stage-specific application tools are discoverable from every page and
  state-gated at execution: each answers with the next safe step when its
  moment has not arrived. Agent-prepared answers keep their provenance. While
  a live, application-bound assistance request or delegation exists, the site
  renders the application read-only and revisions stay in the external agent
  client. If that authority expires, is declined, or is withdrawn, the person
  can continue directly on Jobbbler without losing the prepared work.
- Sharing reviewed data requires explicit permission bound to the exact
  reviewed payload, recipient, purpose, fields, and notice — permission
  applies only to this exact application. The external agent client receives
  every completed value and sensitivity marker for the final review, plus an
  optional first-party review link. This one private result uses a dedicated
  64 KB bound because the values themselves are the decision. The server
  accepts only the exact live request ID and draft version and stores the
  decision channel as request-bound evidence. It verifies that exact request
  and unchanged review, not the person's identity.
- The person can withdraw consent through the same agent interface in one tool
  call. Future consent-based processing stops immediately; any lawful
  historical submission receipt remains intact.
- Submission needs a fresh, short-lived, single-use confirmation, and the
  sealed payload cannot change between the person's review and the submit.
- Every role in the current demo catalog supports Jobbbler-managed delivery;
  the server still fails closed for any unsupported future application mode.

## The technology — for judges

> Not an AI job board. A proof that any data-rich website can become safely
> operable by an external browser agent — without a separate MCP server,
> without hiding what changed, and without confusing tool access with human
> authority.

> Jobbbler does not only expose tools. It also teaches a visiting agent the
> safest useful path through them—without executing the plan or granting
> authority.

Jobbbler registers 28 focused WebMCP tools directly in the page. The same set
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
GBP, CAD at pinned rates) with human-readable evidence strings. All 29 focused
WebMCP tools are registered on every page and gate private or state-specific
behavior at execution time.

WebMCP capability is live while the page is open; durable alerts are an honest
server-side continuation, not a claim that the browser agent remains alive.
Alerts evaluate saved-search changes deterministically, queue idempotent
deliveries, and require a verified email endpoint. The request/decision pair
binds the person's external-client decision to one exact alert policy and
mailbox challenge. The first visit needs no account at all: a loginless private
owner session works immediately, while passwordless email recovery remains an
optional durability upgrade for applications and saved searches.

The application flow is agent-first with request-bound human decisions. The
agent checks readiness, calls `request_application_assistance`, and waits while
the external agent client presents the request. Only
`decide_application_assistance` with the person's decision and the exact live
request ID can enable short-lived, draft-bound assistance; the same tool can
withdraw that active authority only for the exact bound request. The agent can
then propose truthful answers in bounded batches and request one exact
submission review. `request_submission_review` returns every exact field value
and sensitivity marker to the already-authorized agent client, together with
the recipient, purpose, privacy-notice version, request binding, expiry, and an
optional first-party review URL. Its dedicated 64 KB bound is the deliberate
exception to compact routine results. The external agent client presents those
values and relays the person's decision. The server accepts a submission
decision only when it is bound to the exact request ID and draft version,
rechecks the unchanged review snapshot, seals the reviewed payload, and
consumes a short-lived single-use confirmation for the idempotent submit. The
stored consent receipt records the decision channel as evidence and
deliberately proves the request and server state, not cryptographic human
identity. Raw chat and reusable credentials stay out of WebMCP JSON results.
Stored consent evidence represents reviewed values with field keys and a
review hash, not the raw values. The same global tool surface
lets the person withdraw that consent in one call; future consent-based
processing stops while historical submission receipts remain honest.

A purely manual application can still finish in the first-party UI. While a
live assistance request or delegation exists, the site offers no local editing,
approval, consent, or submission bypass; server routes require revisions and
those decisions to be relayed through the external agent client. Historical
agent-written answers stay visibly attributed but do not permanently lock the
application after that authority ends.
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

- A real WebMCP surface: 28 focused tools for job, comparison, saved-search,
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
- An optional two-step `enable_workspace_recovery` action that adds continuity
  without granting consent, application approval, or an alert subscription.
- A two-step `recover_jobbbler_workspace` action that restores applications and
  saved searches from the external agent client without echoing the supplied
  email or code or returning owner, private, or session data.
- A paged `get_applications` index that lets a recovered agent rediscover
  private work and receipt availability without returning candidate answers.
- A direct `prepare_application` entry point that removes redundant preflight
  while preserving the separate assistance and final-submission decisions.
- Search, comparison, saved searches, and a managed fictional application
  connect into one coherent journey.
- The global Agent layer — Activity, Tools, and Guide — makes tool work
  understandable without turning the portal into a developer console.
- Progressive identity and verified-email alerts preserve a low-friction start
  while supporting durable ownership.
- Request-bound consent receipts connect the agent-client decision to an exact
  server record without overstating identity assurance.
- Explicit delegation, immutable review, and one-time confirmation keep
  Jobbbler-managed application actions controlled, while the command fails
  closed for any unsupported delivery mode.
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
source HTML. Routine WebMCP results stay within 1.5 KB; larger named bounds are
used only where the requested content requires them: 2 KB for the planner,
16 KB for an application index, 20 KB for a full role, and 64 KB for the exact
private application review shown after application-bound assistance approval.

## Open source and local run

License and public repository: [MIT-licensed Jobbbler source](https://github.com/der-bear/jobbbler).

Local run instructions: [README](https://github.com/der-bear/jobbbler#run-locally).
