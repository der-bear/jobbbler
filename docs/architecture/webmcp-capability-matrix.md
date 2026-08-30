# WebMCP Capability Matrix

Status: release candidate, 2026-08-30

This matrix ties the WebMCP draft to one Jobbbler behavior, one blocking
verification, and one judge-visible proof. WebMCP is an agent interface over
the real product, not a decorative wrapper or a separate MCP server.

| WebMCP capability or limit                                           | Jobbbler behavior                                                                                                                                        | Blocking verification                                                                  | Demo proof                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `document.modelContext` is a secure-context API and may be absent    | Feature detection leaves the ordinary job portal fully usable                                                                                            | Unsupported and malformed contexts register nothing and do not break search            | Open the same page with and without WebMCP support                   |
| `registerTool()` is asynchronous                                     | One provider registers the complete 24-tool set before reporting ready                                                                                   | Partial failure cleans up the set and reports a recoverable unavailable state          | Agent view changes from preparing to ready with the exact count      |
| Tools are discovered from the live page                              | The same focused set remains registered on Home, Jobs, Role, Compare, Alerts, Applications, and How it works                                             | Navigation tests compare exact tool names across routes                                | Move between pages without losing a capability                       |
| More and overlapping tools increase model cost and selection errors  | Lifecycle primitives were consolidated into outcome tools and the redundant capability-dump tool was removed                                             | Catalog and eval fixtures agree on 24 unique purposes                                  | Tools tab shows a readable outcome-grouped catalog                   |
| Tool execution receives an `AbortSignal`                             | Every request and long-running operation receives the browser cancellation signal                                                                        | Cancellation produces a bounded cancelled result and no stale UI overwrite             | Cancel one search and show the activity receipt                      |
| `readOnlyHint` and `untrustedContentHint` are hints, not authority   | Every manifest declares honest annotations; normalized job content is treated as untrusted                                                               | Shared manifest validation checks every tool and application state                     | Inspect one read and one action tool in Agent view                   |
| JSON Schema guides the model but does not replace runtime validation | Zod rejects unknown fields, malformed IDs, duplicates, stale versions, and invalid ranges before mutation                                                | Deterministic invalid-input and atomicity tests pass on SQLite and PostgreSQL adapters | Send one invalid request and show a concise self-correction hint     |
| Tool output should be concise and useful for the next action         | Every result is JSON-serializable and capped at 1.5 KB; workflow results include `nextTool` and required inputs                                          | Size tests cover every workflow and representative success/error result                | Search returns compact role facts and exact IDs                      |
| Page state should reflect completed tools                            | Search, comparison, alerts, and navigation reuse the same commands and UI bridges as the human interface                                                 | Tests assert URL and visible state update before completion                            | Ask for a search and watch URL, filters, results, and Activity agree |
| WebMCP does not provide cryptographic agent identity                 | Browser capability, loginless owner session, draft ownership, and operation authority are separate server boundaries                                     | Server tests ignore claimed caller identity and validate owner-bound IDs               | Explain global discovery without claiming global authorization       |
| Human interaction APIs and consent semantics are still evolving      | `requires_user_action` returns a server request ID plus exact presentation facts for the external agent client                                           | The server accepts only a decision bound to the live request and current draft version | The agent asks once for assistance and once for the exact submission |
| Consent evidence is application responsibility                       | On approval, Jobbbler stores recipient, purpose, fields, notice version, decision channel, request evidence, and reviewed version before submitting once | Stale, replayed, mismatched, or declined decisions cannot submit                       | Present the exact pending review and stop before the decision        |
| External job content may contain prompt injection                    | Raw source HTML and instructions never enter tool results; normalized facts are marked untrusted                                                         | Output allowlists and redaction tests reject source payloads and secrets               | Inspect provenance and known unknowns without source instructions    |
| Browser WebMCP is tab-bound                                          | Durable job alerts continue in the worker; the site never claims the browser agent stays alive                                                           | Worker, lease, idempotency, and delta tests pass                                       | Close the tab, then show a later saved-search delta                  |

## Stable global tool strategy

All 24 tools are registered on every route. Six are natural entry points:

- `plan_job_workflow` — optional, read-only, route-aware advice for five goals;
- `get_search_filters` — accepted vocabulary for exact schemas;
- `search_jobs` — source-backed catalog search;
- `open_job_details` — navigate to a known role;
- `prepare_application` — create or reopen one owner-bound draft;
- `open_jobbbler_page` — explicit navigation to another workspace.

The other tools remain discoverable but validate their prerequisites at
execution: exact job, saved-search, schedule, or draft IDs; owner access; and
the current workflow version or stage. Global discovery never grants global
application authority.

`plan_job_workflow` is deliberately advisory. It returns a compact sequence,
the best next tool for the current route, required inputs, and human decision
points. It executes nothing, grants nothing, and does not replace clear direct
tool descriptions. There is no workflow engine, DSL, generic execute tool, or
MCP Resource dependency.

## Agent-first application sequence

1. `prepare_application` creates or reopens the chosen private draft.
2. `get_application_readiness` reports only counts, missing field keys, and the
   next safe tool; it does not return private answers.
3. `request_application_assistance` asks once for draft-bound, short-lived
   preparation authority in the external agent client.
4. `decide_application_assistance` records the exact approved or declined
   decision.
5. `propose_application_updates` writes one atomic batch from supplied facts;
   the agent asks only for missing facts and never invents sensitive data.
6. `request_submission_review` presents recipient, purpose, included fields,
   privacy notice, request ID, and draft version in the agent client.
7. `decide_application_submission` records consent and submits the unchanged
   internal application once, or records no submission on decline.

External-source roles are never falsely reported as submitted. Their capability
response exposes only a validated HTTPS employer page; Jobbbler creates no
application draft, prepares or discloses no application data, and records no
receipt or handoff.

## Why imperative registration

Jobbbler uses only the imperative API. The same server commands power the human
interface and WebMCP, while imperative manifests provide typed inputs, bounded
results, cancellation, annotations, activity receipts, and precise state-gated
errors. Duplicating the same actions as declarative form tools would add
overlap, and annotating private email or recovery forms would route values
through the agent contrary to the privacy model.

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
