# Product Experience

## Marketing layer (design source of truth)

Every public description of Jobbbler — README, Devpost, video narration,
gallery captions, in-product copy — derives from this layer.

- Principle: **Sophisticated underneath. Obvious on the surface.**
- Tagline: **Find once. Stay updated. Apply with control.**

What Jobbbler is:

> Not an AI job board. A proof that any data-rich website can become safely
> operable by an external browser agent — without a separate MCP server,
> without hiding what changed, and without confusing tool access with human
> authority.

Story order everywhere: **problem** (job search is repetitive; people rerun
the same searches and still risk missing the one meaningful change) →
**solution** (describe it once; a compatible browser agent searches, keeps it
current, and reports only what changed — no separate MCP server) → **trust**
(when applying, the flow slows down: exact disclosure, explicit permission,
final human confirmation) → **technology** (a global Agent layer and WebMCP).

Translation table. Marketing copy uses the right column; the left column
stays in architecture and design documents.

| Architecture term        | Human translation                                 |
| ------------------------ | ------------------------------------------------- |
| WebMCP tools             | works with your browser agent                     |
| stable Agent layer       | your agent can start safely from any page         |
| durable scheduler        | keeps checking after you close the page           |
| search delta             | only tells you what changed                       |
| guest owner              | no account required                               |
| email recovery           | restore your saved searches with email            |
| delegated authority      | your agent can only do what you allow             |
| consent receipt          | a record of what you approved                     |
| payload-bound permission | permission applies only to this exact application |
| external application     | continue on the employer's website                |
| source provenance        | where this information came from                  |

The same rule shapes in-product vocabulary: statuses read as human statements
— “Checking daily”, “Checking weekly”, “Paused” — never as system vocabulary
such as “Monitoring state”.

## Product promise

Jobbbler is a conventional technology-jobs portal first. It becomes
agent-operable when a browser agent opens the live site, without turning the
product into a chatbot or requiring a separate MCP server.

The experience should be understandable in seconds:

1. Search for a technology role.
2. Inspect source-backed evidence and what to verify.
3. Save a useful search or start an application.
4. Let an external browser agent accelerate the same journey when desired.
5. Keep identity, data permission, and the final consequential action under
   human control.

The concise narrative is: **A job portal that becomes agent-operable without
becoming agent-controlled.**

## Two adapters, one product

The human interface and WebMCP tools are two adapters over the same server
commands and policies.

- A person can search, inspect role and agent-assisted comparison results,
  save, monitor, and complete a manual internal application through the visible
  interface without WebMCP. The current human search and role-detail surfaces
  do not initiate comparisons. When the person chooses the agent-assisted
  application path, its draft is read-only on the site and its revisions,
  assistance decisions, and submission decisions stay in the external agent
  client. Active assistance remains request-bound and revocable.
- A compatible browser agent can start on any page with the complete 26-tool
  set and execute structured actions without simulating DOM clicks. Six are
  clear entry points; the rest validate their prerequisites when called. The
  same capability set remains discoverable across navigation.
- WebMCP is tab-bound and ephemeral. The tools exist while the page is loaded
  in the agent's live browser context; background alerts continue through the
  regular worker after the tab closes.
- The conversation belongs to the external agent client. Jobbbler does not
  embed a second chat surface.
- A bounded structured `requires_user_action` response gives the external agent
  client a compact request-bound reference, counts, sensitivity categories,
  and the owner-review URL. Exact values and their field-level sensitivity
  markers remain on that visible owner review surface, which a compatible
  client may show or observe. The person decides in the agent client; Jobbbler
  binds the decision to the exact request and stores a values hash and
  versioned server-side consent record without retaining those raw values or
  claiming cryptographic identity.

## Route experience

The catalog has **26 focused tools**, all registered on every page. Six are
clear entry points; private and stage-specific tools remain state-gated at
execution.

| Route                         | Primary human task                      | Agent tools                                                                                                                                                                                                                                                             | Visible trust feedback                                                                                                                                        |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every page `*`                | One obvious task per screen             | Entry tools: `plan_job_workflow` (advisory only), `get_search_filters`, `search_jobs`, `open_job_details`, `prepare_application`, `open_jobbbler_page`                                                                                                                  | The global Agent layer starts with Activity, then Tools and Guide                                                                                             |
| Search `/`                    | Express an outcome and inspect matches  | Search-area tool `get_search_state`, globally registered like the rest of the catalog and relevant when readable search state exists; its bounded result includes an explicit truncation summary                                                                        | URL, filters, result count, and Agent activity receipts update together                                                                                       |
| Role `/jobs/:jobId`           | Understand one opportunity              | `get_job_details`, `get_job_application_capability` (whether Jobbbler may prepare it, which decisions stay human, or whether the person continues on the employer site), `compare_jobs`                                                                                 | Provenance, freshness, evidence, “What to verify”, and a clear next action                                                                                    |
| Compare `/compare`            | Inspect an agent-assisted shortlist     | `get_comparison`, `add_job_to_comparison`, `remove_job_from_comparison`                                                                                                                                                                                                 | One readable evidence table with differences and missing facts                                                                                                |
| Saved `/saved`                | Stay updated on an explicit search      | `get_saved_alerts`, `set_job_alert_state`, `open_saved_search`, `get_latest_search_update` (only what changed since the last check)                                                                                                                                     | Plain-language status (“Checking daily”, “Paused”), next run, “N changes since the last check”, and a masked destination only                                 |
| Application `/apply/:draftId` | Prepare one managed internal disclosure | Seven outcome tools: readiness, one assistance decision, bounded answer preparation, one exact review, one submission decision, and one-call consent withdrawal. They stay discoverable but enforce owner and stage checks when called. External roles create no draft. | The agent client owns assisted-flow questions and decisions; Jobbbler stores bounded consent evidence and a receipt only for an approved internal application |

## Visual hierarchy

Jobbbler uses an editorial utility aesthetic: closer to a well-structured
document than a dashboard made of cards.

- Typography, spacing, and thin rules create hierarchy.
- Color communicates meaning, action, warning, or failure; it is not
  decoration.
- A vacancy reads like a document row that expands into evidence and facts.
- Controls appear where a decision is possible and disappear when they have no
  current function.
- Shadows, rounded containers, decorative illustration, status badges, and
  dashboard chrome are kept to the minimum needed for usability.
- Light and dark themes preserve the same reading order and contrast.
- Every screen has one obvious task and one primary next step.

Dark-theme token contrast was rechecked on the canvas (`#191919`), raised
surface (`#1f1f1f`), and muted surface (`#262625`). Muted text (`#a3a29e`)
measures 6.88:1, 6.45:1, and 5.93:1 respectively. Strong control borders
(`#6f6f6b`) measure 3.48:1, 3.27:1, and 3.00:1. Those tokens already meet the
intended AA text and non-text thresholds, so visual review alone is not a
reason to brighten them. The lower-contrast base border remains a decorative
separator rather than the only affordance for a control.

An element earns space only when it helps a person read, decide, act,
understand state, or understand risk. Anything else is removed or placed in an
explicit disclosure.

## The Agent panel

The global Agent layer is available on every page. On desktop it is a
resizable side panel; on mobile (and after being closed) a compact “Agent
view” button opens it. It is a transparency layer, not a competing
workspace and not a source of authority.

- The header states the panel's purpose in one line; a status row shows the
  live WebMCP state and the 26 capabilities discoverable across Jobbbler.
- Three tabs, in this order: **Activity**, **Tools**, and **Guide**.
- Activity entries are two-level: the human sentence comes first, then the
  technical line — tool name, status, and duration. Running work, required
  approval, and failures surface automatically.
- The Tools tab shows all 26 tools grouped by outcome and explains that private
  actions still require an owned draft and the correct stage.
- The Guide tab offers “Try it in 10 seconds”, the suggested workflows, and a
  note that `plan_job_workflow` serves the same plans to agents — advisory
  only.
- Summaries stay redacted and never expose reusable identifiers or private
  payloads. Owner activity is a near-real-time projection; the authoritative
  result is always the regular API response and persisted domain state.
- The ordinary page UI carries the trust feedback, whether or not a visitor
  opens the Agent layer.

## Challenge presentation

The submission should show a real external browser-agent session rather than a
simulated chat inside Jobbbler:

1. The user asks for a job outcome in the agent client.
2. The agent opens Jobbbler, discovers the same 26 focused tools on any page,
   and may ask `plan_job_workflow` for recommended safe steps when useful.
3. It invokes `search_jobs`; the real URL, filters, and results update.
4. Navigation preserves the entire tool set; role and application actions
   validate their explicit IDs and workflow state when invoked.
5. The agent prepares an application and requests exact data permission. The
   person gives the draft-scoped assistance decision in the external agent
   client, then receives the exact submission review there.
6. The demo stops with that final decision pending. Nothing is shared or
   submitted on camera.

The public `/about/webmcp` explanation may illustrate this sequence, but it
must remain optional and must not add a fake agent, decorative console, or
alternate product workflow.
