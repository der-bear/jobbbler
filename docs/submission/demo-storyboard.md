# Jobbbler demo storyboard

Target runtime: 2 minutes 35 seconds to 2 minutes 50 seconds. Record a real local or production run; do not substitute mock overlays for WebMCP or safety states.

| Time      | Shot and narration                                                                                                                                                                       | Evidence to keep visible                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 0:00–0:12 | Open Jobbbler search. “Jobbbler is an evidence-first workspace for people who want agent help without handing over control.”                                                             | Search results, filters, source labels, normal browser fallback.                                          |
| 0:12–0:27 | Show the WebMCP status changing from preparing to ready in a supported browser context. “The browser registers only tools relevant to this route.”                                       | Actual WebMCP readiness and registered tool count; no edited status badge.                                |
| 0:27–0:45 | Ask the agent to narrow the search. “The agent calls the real `search_jobs` route tool; the same visible filters and results update.”                                                    | Filter changes, results update, Agent Activity row with a safe summary.                                   |
| 0:45–1:00 | Compare up to three roles. “I can inspect the comparison in the app, while the agent uses the route’s bounded compare capability.”                                                       | Compare workspace and activity state; source/evidence context.                                            |
| 1:00–1:22 | Save the search and show the alert setup. “A durable alert requires a verified destination—not just a typed email address.”                                                              | Saved workspace, verification prompt, schedule preview/activation.                                        |
| 1:22–1:38 | Show the Saved card’s latest-run state. “The worker evaluates the saved search, records changes deterministically, and keeps delivery status visible.”                                   | Baseline/change counts and accepted, pending, or retrying status from a real run. Do not show an address. |
| 1:38–1:56 | Open the fictional internal-demo employer role and create an application draft. “The agent can help prepare work, but it does not receive a reusable credential or authority to submit.” | Clearly fictional employer, draft provenance/validation view, Agent Activity.                             |
| 1:56–2:18 | Show data consent/delegation and review. “Permissions are specific to this draft and purpose, and can be revoked. Review is separate from confirmation.”                                 | Human-owned consent/delegation/review surfaces; do not imply autonomous approval.                         |
| 2:18–2:37 | Request and perform the final confirmation. “Submission uses a short-lived, single-use confirmation and returns an idempotent receipt.”                                                  | Confirmation state and receipt; never show a secret/token.                                                |
| 2:37–2:48 | Return to the activity rail. “Jobbbler makes the agent’s useful work visible, while keeping identity, notifications, and final actions under human control.”                             | Completed activity entries, safe summaries, normal UI still usable.                                       |

## Recording guardrails

- Use the actual WebMCP-enabled browser context for tool shots; if it is unavailable, state that capability truthfully and use the standard UI instead.
- Use only synthetic demo listings and a test/owned verified email endpoint.
- Do not record cookies, OTPs, confirmation secrets, ciphertext, raw provider responses, database paths, terminal credentials, or source payloads.
- Keep narration concrete: describe what is currently visible, not future roadmap claims.
- Replace these before publishing: **[PRODUCTION_URL]**, **[VIDEO_URL]**, **[REPOSITORY_URL]**.
