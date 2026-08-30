# Jobbbler demo storyboard

Target runtime: 2 minutes 40 seconds. Record a real local or production run;
every tool call, panel entry, and state on screen must come from the live
build.

Story order: problem → solution → trust → technology, told in five beats.

| Time      | On screen                                                                                                                                                                                                                                                                                                                                                                                                                     | Narration                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | An ordinary, beautiful portal. The search workspace with the "Search jobs" hero, live filters, and a role page that reads like an article — no agent anywhere yet.                                                                                                                                                                                                                                                            | “Finding a job should not mean repeating the same search every day.”                                 |
| 0:15–0:45 | The user asks the external agent in plain words. Jobbbler opens; its global Agent layer shows Activity, Tools, and Guide, then the visible search and filters update as `search_jobs` runs. Activity shows a human sentence first, then `search_jobs · Complete · duration`.                                                                                                                                                  | “The browser agent can begin safely from any page. No separate MCP server or connector is required.” |
| 0:45–1:20 | The search is saved. The Saved page shows the alert card — “Checking daily”, schedule preview, email verification — then the tab closes.                                                                                                                                                                                                                                                                                      | “Jobbbler keeps checking after the tab is closed and reports only meaningful changes.”               |
| 1:20–1:55 | The delta moment. Back on Saved, the card reads “N changes since the last check · M matching”. The agent calls `get_latest_search_update` and relays its “Since the last check: …” summary — new, updated, and closed roles, never the full list again.                                                                                                                                                                       | “Three new roles. One salary update. Two closed postings.”                                           |
| 1:55–2:40 | The application flow stops at the person's decision. One document-like review page: agent-prepared answers carry their provenance and stay editable, the missing-details summary shrinks as `propose_application_updates` fills the draft, and then the exact disclosure — recipient, purpose, fields, notice — is presented for one explicit decision before anything is shared or submitted. The receipt lands in Activity. | “The agent can prepare. The candidate remains in control.”                                           |

Finale card: **“A familiar job portal for people. A structured workflow
surface for agents.”** Alternate closing line if the cut needs a softer end:
**“The complicated technology stays under the hood. On the surface, Jobbbler
simply helps people find work.”**

## Recording guardrails

- No simulated chat and no mock overlays: use a real WebMCP-enabled agent
  client, real tool calls, and the states they actually produce. If WebMCP is
  unavailable, say so truthfully and show the ordinary UI instead.
- The delta narration must match the recorded run. Seed the saved search so
  the real `get_latest_search_update` result contains the changes you narrate,
  or adjust the line to the actual counts.
- Use only synthetic demo listings, the clearly fictional internal-demo
  employer for application footage, and a test/owned verified email endpoint.
  Do not show a full email address.
- Do not record cookies, OTPs, confirmation secrets, ciphertext, raw provider
  responses, database paths, terminal credentials, or source payloads.
- State plainly that WebMCP is live-page capability and that Jobbbler's
  server-side worker, not the closed browser tab, continues saved-search
  checks.
- If `get_search_state` is shown, include its explicit truncation summary when
  bounded criteria omit or shorten values; do not present a partial state as a
  complete one.
- Keep narration concrete: describe what is currently visible, not future roadmap claims.
- Replace these before publishing: **[PRODUCTION_URL]** and **[VIDEO_URL]**. Repository: https://github.com/der-bear/jobbbler.
