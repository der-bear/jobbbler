# Product Experience

## Product promise

Jobbbler is a conventional technology-jobs portal first. It becomes agent-operable when a browser agent opens the live site, without turning the product into a chatbot or requiring a separate MCP server.

The experience should be understandable in seconds:

1. Search for a technology role.
2. Inspect source-backed evidence and unknowns.
3. Save a useful search or start an application.
4. Let an external browser agent accelerate the same journey when desired.
5. Keep identity, data permission, and the final consequential action under human control.

The concise narrative is: **A job portal that becomes agent-operable without becoming agent-controlled.**

## Two adapters, one product

The human interface and route-scoped WebMCP tools are two adapters over the same server commands and policies.

- A person can complete every core journey through the visible interface without WebMCP.
- A compatible browser agent can open the site, discover tools registered by the active page, and execute structured actions without simulating DOM clicks.
- WebMCP is tab-bound and ephemeral. The tools exist while the page is loaded in the agent's live browser context; background alerts continue through the regular worker after the tab closes.
- The conversation belongs to the external agent client. Jobbbler does not embed a second chat surface.
- A structured `requires_user_action` response gives the agent client exact review facts and a server request ID. A separate confirmation tool can record the explicit agent-mediated action as a versioned receipt; raw chat is not stored, and the receipt does not claim cryptographic human or agent identity.

## Route experience

| Route       | Primary human task                     | Agent capability                                                | Visible trust feedback                                                 |
| ----------- | -------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Search      | Express an outcome and inspect matches | Read current criteria and run a validated search                | URL, filters, result count, and an optional activity receipt update    |
| Role        | Understand one opportunity             | Read the source-backed role and prepare the next route          | Provenance, freshness, evidence, unknowns, and a clear next action     |
| Compare     | Resolve a shortlist                    | Read and refine the active comparison                           | One evidence table with differences and missing facts                  |
| Saved       | Monitor an explicit search             | Read saved alerts and pause or resume a schedule                | Monitoring state, next run, latest outcome, and masked delivery only   |
| Application | Prepare one reviewed disclosure        | Fill safe draft fields, seal review, and request scoped actions | Distinct profile, review, permission, confirmation, and receipt stages |

## Visual hierarchy

Jobbbler uses an editorial utility aesthetic: closer to a well-structured document than a dashboard made of cards.

- Typography, spacing, and thin rules create hierarchy.
- Color communicates signal, action, warning, or failure; it is not decoration.
- A vacancy reads like a document row that expands into evidence and facts.
- Controls appear where a decision is possible and disappear when they have no current function.
- Shadows, rounded containers, decorative illustration, status badges, and dashboard chrome are kept to the minimum needed for usability.
- Light and dark themes preserve the same reading order and contrast.
- Every screen has one obvious task and one primary next step.

An element earns space only when it helps a person read, decide, act, understand state, or understand risk. Anything else is removed or placed in an explicit disclosure.

## Agent observability

Agent Activity is a secondary transparency layer, not a competing workspace and not a source of authority.

- The desktop search rail shows one compact, collapsed disclosure when idle.
- Mobile exposes the same history through a labeled bottom sheet.
- Running work, required approval, and failures elevate the disclosure automatically.
- The expanded view states what changed using redacted summaries and never exposes reusable identifiers or private payloads.
- Technical capability details remain inside the disclosure or the WebMCP explanation page.
- Owner activity is a near-real-time projection. The authoritative result is always the regular API response and persisted domain state.

## Challenge presentation

The submission should show a real external browser-agent session rather than a simulated chat inside Jobbbler:

1. The user asks for a job outcome in the agent client.
2. The agent opens Jobbbler and discovers the active route's tools.
3. It invokes `search_jobs`; the real URL, filters, and results update.
4. Navigation replaces the search tools with role- or application-specific tools.
5. The agent prepares an application, presents exact data permission in the agent client, and records the request-bound decision separately from final confirmation.
6. Jobbbler displays the resulting state and a concise activity receipt when viewed.

The public `/about/webmcp` explanation may illustrate this sequence, but it must remain optional and must not add a fake agent, decorative console, or alternate product workflow.
