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
| external handoff         | continue on the employer's website                |
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

- A person can complete every core journey through the visible interface
  without WebMCP.
- A compatible browser agent can start on any page with six stable, site-wide
  tools and execute structured actions without simulating DOM clicks. The same
  capability set remains discoverable across navigation.
- WebMCP is tab-bound and ephemeral. The tools exist while the page is loaded
  in the agent's live browser context; background alerts continue through the
  regular worker after the tab closes.
- The conversation belongs to the external agent client. Jobbbler does not
  embed a second chat surface.
- A structured `requires_user_action` response gives the external agent client
  exact review facts and a server request ID. The person decides in that agent
  client; Jobbbler binds the decision to the exact request and stores a
  versioned server-side consent record without claiming cryptographic identity.

## Route experience

The catalog has **24 focused tools**, all registered on every page. Six are
clear entry points; private and stage-specific tools remain state-gated at
execution.

| Route                         | Primary human task                     | Agent tools                                                                                                                                                                                                                             | Visible trust feedback                                                                                                        |
| ----------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Every page `*`                | One obvious task per screen            | Entry tools: `plan_job_workflow` (advisory only), `get_search_filters`, `search_jobs`, `open_job_details`, `prepare_application`, `open_jobbbler_page`                                                                                  | The global Agent layer starts with Activity, then Tools and Guide                                                             |
| Search `/`                    | Express an outcome and inspect matches | Contextual `get_search_state`, which includes an explicit truncation summary for bounded criteria                                                                                                                                       | URL, filters, result count, and Agent activity receipts update together                                                       |
| Role `/jobs/:jobId`           | Understand one opportunity             | `get_job_details`, `get_job_application_capability` (how this role accepts applications — what the agent may prepare, what stays human, whether an external handoff is required), `compare_jobs`                                        | Provenance, freshness, evidence, “What to verify”, and a clear next action                                                    |
| Compare `/compare`            | Resolve a shortlist                    | `get_comparison`, `add_job_to_comparison`, `remove_job_from_comparison`                                                                                                                                                                 | One evidence table with differences and missing facts                                                                         |
| Saved `/saved`                | Stay updated on an explicit search     | `get_saved_alerts`, `set_job_alert_state`, `open_saved_search`, `get_latest_search_update` (only what changed since the last check)                                                                                                     | Plain-language status (“Checking daily”, “Paused”), next run, “N changes since the last check”, and a masked destination only |
| Application `/apply/:draftId` | Prepare one reviewed disclosure        | Seven outcome tools: readiness, one assistance decision, bounded answer preparation, one exact review, one submission decision, and one-call consent withdrawal. They stay discoverable but enforce owner and stage checks when called. | The agent client owns questions and decisions; Jobbbler stores the exact consent evidence and receipt                         |

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

An element earns space only when it helps a person read, decide, act,
understand state, or understand risk. Anything else is removed or placed in an
explicit disclosure.

## The Agent panel

The global Agent layer is available on every page. On desktop it is a
resizable side panel; on mobile (and after being closed) a compact “Agent
activity” button opens it. It is a transparency layer, not a competing
workspace and not a source of authority.

- The header states the panel's purpose in one line; a status row shows the
  live WebMCP state and the 24 capabilities discoverable across Jobbbler.
- Three tabs, in this order: **Activity**, **Tools**, and **Guide**.
- Activity entries are two-level: the human sentence comes first, then the
  technical line — tool name, status, and duration. Running work, required
  approval, and failures surface automatically.
- The Tools tab shows all 24 tools grouped by outcome and explains that private
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
2. The agent opens Jobbbler, discovers the same 24 focused tools on any page,
   and may ask `plan_job_workflow` for recommended safe steps when useful.
3. It invokes `search_jobs`; the real URL, filters, and results update.
4. Navigation preserves the entire tool set; role and application actions
   validate their explicit IDs and workflow state when invoked.
5. The agent prepares an application and requests exact data permission. The
   person gives the draft-scoped assistance decision and final exact submission
   decision in the external agent client.
6. Jobbbler displays the resulting state and a concise activity receipt when
   viewed.

The public `/about/webmcp` explanation may illustrate this sequence, but it
must remain optional and must not add a fake agent, decorative console, or
alternate product workflow.
