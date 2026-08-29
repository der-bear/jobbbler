# Jobbbler demo storyboard

Target runtime: 2 minutes 35 seconds to 2 minutes 50 seconds. Record a real local or production run; do not substitute mock overlays for WebMCP or safety states.

| Time      | Shot and narration                                                                                                                                                                       | Evidence to keep visible                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 0:00–0:12 | Begin in the external agent client. “Jobbbler is a proof of value for the agentic web: a normal job portal a browser agent can understand without a separately configured MCP server.”     | Real agent conversation and the live Jobbbler URL; no simulated embedded chat.                            |
| 0:12–0:27 | Let the agent open Jobbbler. “The site registers only the tools relevant to this route, and remains a complete ordinary website.”                                                          | Actual WebMCP discovery/readiness, search results, source labels, and normal browser fallback.             |
| 0:27–0:45 | Ask the agent to narrow the search. “The agent calls the real `search_jobs` route tool; the same visible filters and results update.”                                                    | Filter changes, results update, Agent Activity row with a safe summary.                                   |
| 0:45–1:00 | Compare up to three roles. “I can inspect the comparison in the app, while the agent uses the route’s bounded compare capability.”                                                       | Compare workspace and activity state; source/evidence context.                                            |
| 1:00–1:22 | Save the search and show the alert setup. “A durable alert requires a verified destination—not just a typed email address.”                                                              | Saved workspace, verification prompt, schedule preview/activation.                                        |
| 1:22–1:38 | Show the Saved card’s latest-run state. “The worker evaluates the saved search, records changes deterministically, and keeps delivery status visible.”                                   | Baseline/change counts and accepted, pending, or retrying status from a real run. Do not show an address. |
| 1:38–1:56 | Open the fictional internal-demo employer role and create an application draft. “The agent can help prepare work, but it does not receive a reusable credential or authority to submit.” | Clearly fictional employer, draft provenance/validation view, Agent Activity.                             |
| 1:56–2:18 | Ask the agent to share the reviewed data. “The agent client presents the exact recipient, purpose, fields, and notice. A separate request-bound action records approval.”                 | Real `requires_user_action` presentation and resulting server-backed permission state; no raw chat claim. |
| 2:18–2:37 | Request and perform the final confirmation. “Submission uses a short-lived, single-use confirmation and returns an idempotent receipt.”                                                  | Confirmation state and receipt; never show a secret/token.                                                |
| 2:37–2:48 | Return to the activity rail. “Jobbbler makes the agent’s useful work visible, while keeping identity, notifications, and final actions under human control.”                             | Completed activity entries, safe summaries, normal UI still usable.                                       |

## Recording guardrails

- Use the actual WebMCP-enabled browser context for tool shots; if it is unavailable, state that capability truthfully and use the standard UI instead.
- Use only synthetic demo listings and a test/owned verified email endpoint.
- Do not record cookies, OTPs, confirmation secrets, ciphertext, raw provider responses, database paths, terminal credentials, or source payloads.
- Keep narration concrete: describe what is currently visible, not future roadmap claims.
- State that WebMCP is live-page capability and that Jobbbler's worker, not the closed browser tab, continues saved alerts.
- Replace these before publishing: **[PRODUCTION_URL]**, **[VIDEO_URL]**, **[REPOSITORY_URL]**.
