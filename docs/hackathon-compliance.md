# OpenAI WebMCP Challenge Compliance

This checklist maps the official rules in `docs/rules/rules.md` to concrete Jobbbler evidence. It is updated throughout delivery and re-verified against the live rules immediately before submission.

| Requirement                                               | Jobbbler evidence                                                                                                                            | Release gate                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| New or meaningfully extended during the submission period | Repository baseline begins on 29 August 2026; implementation uses dated commits after the 25 August start                                    | Git history reviewed               |
| WebMCP-powered web app                                    | Imperative `document.modelContext.registerTool` integration with route-scoped tools, shared UI state, activity feedback, and lifecycle tests | Live tools discovered and called   |
| Working and consistent with video/text                    | Production smoke suite and final in-app-browser walkthrough use the same deployed build shown in media                                       | Production evidence captured       |
| Authorized third-party SDK/API/data use                   | Source-policy registry, official job-feed endpoints, attribution, bounded polling, and first-party synthetic fallback                        | Source policy reviewed             |
| Accessible live URL                                       | Public production deployment, no payment or mandatory account for search                                                                     | Signed-out smoke passes            |
| Strong WebMCP explanation                                 | English project story and README explain why the browser-local semantic layer improves discovery, monitoring, and reviewed applications      | Copy review passes                 |
| Public source repository                                  | Complete source, lockfile, migrations, assets, instructions, and MIT license                                                                 | Signed-out repository check passes |
| Required WebMCP code visible                              | Registration implementation is linked prominently from README                                                                                | Repository preview passes          |
| Demo video under three minutes with audio                 | Public YouTube walkthrough targets 2:40–2:50 and shows working WebMCP in the first fifteen seconds                                           | Final duration/audio verified      |
| No unlicensed media or trademarks                         | Original UI/assets, no copyrighted music, source names used only as factual attribution                                                      | Media review passes                |
| Free judging access through judging period                | Public search and documented demo credentials where consequential flows require identity                                                     | Availability monitor active        |
| English submission materials                              | UI, README, story, instructions, captions, narration, and form fields are English                                                            | Language review passes             |
| Original submission and IP ownership                      | Original design system and product implementation; dependency licenses retained                                                              | License audit passes               |
| Stage-one viability                                       | Deployed coherent product and non-trivial working WebMCP implementation                                                                      | Final checklist passes             |
| WebMCP Leverage                                           | Search, compare, save, alert, and reviewed application tools plus route lifecycle and visible feedback                                       | Tool/eval suite passes             |
| Human-controlled agent authority                          | Resource/action/expiry-bound delegations, requestable-denial approval UI, backend re-evaluation, revoke, and denied-retry evidence           | Authorization suite passes         |
| Consent and privacy by design                             | First-party granular data grants, exact recipient/purpose/payload binding, clear withdrawal, secret/PII redaction, and public architecture   | Privacy journey passes             |
| Observable agent interaction                              | Redacted cursor-based WebSocket activity, point-of-effect feedback, reconnect/refetch semantics, accessibility, and polling fallback         | Realtime contract suite passes     |
| Execution                                                 | Conventional UI, durable backend, production database, scheduler, notifications, security, and observability                                 | Full release gates pass            |
| Potential Impact                                          | Focused IT/adjacent-tech audience; explainable discovery and safer applications                                                              | Case study is evidence-backed      |
| Creativity and Ambition                                   | Agent-native web workflow without separate MCP setup, durable alerts, and human-confirmed actions                                            | Demo narrative verified            |

## Product separation

Jobbbler is the only product in this repository and submission. It covers IT and adjacent-technology vacancies. Local Services is a distinct future product; if built for the challenge, it must have a separate product identity, repository context, case study, story, media package, live URL, and Devpost submission.

## Current known deadline

The locally captured rules state 3 September 2026 at 1:00 pm Pacific Time. Devpost displays the localized equivalent in the authenticated UI. Because rules may change, the live rules and submission form remain the final source of truth.
