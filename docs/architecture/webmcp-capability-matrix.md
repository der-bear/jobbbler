# WebMCP Capability Matrix

Status: release candidate, 2026-08-30

This matrix ties the WebMCP draft to one Jobbbler behavior, one blocking
verification, and one judge-visible proof. WebMCP is an agent interface over
the real product, not a decorative wrapper or a separate MCP server.

| WebMCP capability or limit                                           | Jobbbler behavior                                                                                                                                            | Blocking verification                                                                      | Demo proof                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `document.modelContext` is a secure-context API and may be absent    | Feature detection leaves the ordinary job portal fully usable                                                                                                | Unsupported and malformed contexts register nothing and do not break search                | Open the same page with and without WebMCP support                   |
| `registerTool()` is asynchronous                                     | One provider registers the complete 26-tool set before reporting ready                                                                                       | Partial failure cleans up the set and reports a recoverable unavailable state              | Agent view changes from preparing to ready with the exact count      |
| Tools are discovered from the live page                              | The same focused set remains registered on Home, Jobs, Role, Compare, Alerts, Applications, and How it works                                                 | Navigation tests compare exact tool names across routes                                    | Move between pages without losing a capability                       |
| More and overlapping tools increase model cost and selection errors  | Lifecycle primitives were consolidated into outcome tools and the redundant capability-dump tool was removed                                                 | Catalog and eval fixtures agree on 26 unique purposes                                      | Tools tab shows a readable outcome-grouped catalog                   |
| Tool execution receives an `AbortSignal`                             | Every request and long-running operation receives the browser cancellation signal                                                                            | Cancellation produces a bounded cancelled result and no stale UI overwrite                 | Cancel one search and show the activity receipt                      |
| `readOnlyHint` and `untrustedContentHint` are hints, not authority   | Every manifest declares honest annotations; normalized job content is treated as untrusted                                                                   | Shared manifest validation checks every tool and application state                         | Inspect one read and one action tool in Agent view                   |
| JSON Schema guides the model but does not replace runtime validation | Zod rejects unknown fields, malformed IDs, duplicates, stale versions, and invalid ranges before mutation                                                    | Deterministic invalid-input and atomicity tests pass on SQLite and PostgreSQL adapters     | Send one invalid request and show a concise self-correction hint     |
| Tool output should be concise and useful for the next action         | Every operational result is JSON-serializable and at most 1.5 KB; only the advisory `plan_job_workflow` result may use up to 2 KB                            | Size tests cover every workflow and representative success/error result                    | Search returns compact role facts and exact IDs                      |
| Page state should reflect completed tools                            | Search, comparison, alerts, and navigation reuse the same commands and UI bridges as the human interface                                                     | Tests assert URL and visible state update before completion                                | Ask for a search and watch URL, filters, results, and Activity agree |
| WebMCP does not provide cryptographic agent/human identity proof     | Browser capability, loginless owner session, draft ownership, and operation authority are separate server boundaries                                         | Server tests ignore claimed caller identity and validate owner-bound IDs                   | Explain global discovery without claiming global authorization       |
| Imperative WebMCP has no standardized native consent UI              | `requires_user_action` returns bounded facts or a compact owner-review reference; a compatible client may use its own UI or show or observe the current page | The server accepts only a decision bound to the live request and reviewed resource version | Show the client and owner review without calling either native UI    |
| Consent evidence is application responsibility                       | Jobbbler stores purpose, field keys, a review hash, policy versions, decision channel, request evidence, and resource version, but not exact field values    | Stale, replayed, mismatched, or declined decisions cannot activate or submit               | Present an exact alert or application review before its decision     |
| External job content may contain prompt injection                    | Raw source HTML and instructions never enter tool results; normalized facts are marked untrusted                                                             | Output allowlists and redaction tests reject source payloads and secrets                   | Inspect provenance and known unknowns without source instructions    |
| Browser WebMCP is tab-bound                                          | Durable job alerts continue in the worker; the site never claims the browser agent stays alive                                                               | Worker, lease, idempotency, and delta tests pass                                           | Close the tab, then show a later saved-search delta                  |

## Stable global tool strategy

All 26 tools are registered on every route. Six are natural entry points:

- `plan_job_workflow` — optional, read-only, route-aware advice for five goals;
- `get_search_filters` — accepted vocabulary for exact schemas;
- `search_jobs` — source-backed catalog search;
- `open_job_details` — navigate to a known role;
- `prepare_application` — create or reopen one owner-bound draft for an internal role;
- `open_jobbbler_page` — explicit navigation to another workspace.

The other tools remain discoverable but validate their prerequisites at
execution: exact job, saved-search, schedule, or draft IDs; owner access; and
the current workflow version or stage. Global discovery never grants global
application authority.

## Agent-native monitoring sequence

1. `search_jobs` finds the roles worth monitoring and updates the visible portal.
2. `get_search_state` confirms the exact active criteria.
3. `request_search_alert` saves the canonical criteria, sends a mailbox code,
   and returns one expiring review with masked delivery, recurrence, purpose,
   retention, and withdrawal facts.
4. The external agent client presents that review and asks the person for an
   explicit decision and, on approval, the six-digit code.
5. `decide_search_alert` accepts only the same owner-bound request and unchanged
   policy. Approval verifies the mailbox and activates the schedule; decline
   creates no schedule.
6. `get_saved_alerts` and `get_latest_search_update` expose the resulting durable
   state after the browser closes.

No Jobbbler page interaction is required in this agent workflow. The server
records which exact request the external-client decision covered, while making
no unsupported claim of cryptographic human identity.

`plan_job_workflow` is deliberately advisory. It returns a compact sequence,
the best next tool for the current route, required inputs, and human decision
points. It executes nothing, grants nothing, and does not replace clear direct
tool descriptions. There is no workflow engine, DSL, generic execute tool, or
MCP Resource dependency.

## Agent-first application sequence

1. `prepare_application` creates or reopens the chosen private draft for an internal role.
2. `get_application_readiness` reports only counts, missing field keys, and the
   next safe tool; it does not return private answers.
3. `request_application_assistance` asks once for draft-bound, short-lived
   preparation authority in the external agent client.
4. `decide_application_assistance` records the exact approved or declined
   request decision, or withdraws active assistance only for that same bound
   request.
5. `propose_application_updates` writes one atomic batch from supplied facts;
   the agent asks only for missing facts and never invents sensitive data. The
   site keeps an assisted lineage read-only; revisions remain in the agent
   client.
6. `request_submission_review` freezes the exact application on the visible
   owner review surface and returns a compact request-bound reference with its
   URL, recipient, purpose, field and sensitivity counts, privacy-notice
   version, draft version, and expiry. Exact values are not serialized into the
   WebMCP JSON result; they remain on the owner review page, which a compatible
   client may show or observe as the current tab or surface.
7. `decide_application_submission` records consent and submits the unchanged
   internal application once, or records no submission on decline.

External-source roles are never falsely reported as submitted. Their capability
response exposes only an available validated HTTPS employer page; if none is
available, the agent stops. Jobbbler creates no application draft, prepares or
discloses no application data, and records no receipt or handoff.

## Why imperative registration

Jobbbler uses only the imperative API. The same server commands power the human
interface and WebMCP, while imperative manifests provide typed inputs, bounded
results, cancellation, annotations, activity receipts, and precise state-gated
errors. Duplicating the same actions as declarative form tools would add
overlap, and annotating private email or recovery forms would route values
through the agent contrary to the privacy model. The imperative API defines the
tool exchange, not a native consent surface or agent/human identity attestation.

## Source baseline

- [WebMCP specification](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome WebMCP security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [Chrome WebMCP best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)
- [Chrome WebMCP eval guidance](https://developer.chrome.com/docs/ai/webmcp/evals)
- [WebMCP Challenge resources](https://webmcp.devpost.com/resources)

The sources are re-checked before release because WebMCP is an emerging draft.
Jobbbler never treats annotations, browser presence, or tool discovery as
identity, consent, or authorization.
