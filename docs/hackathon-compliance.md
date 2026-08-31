# OpenAI WebMCP Challenge Compliance

This checklist maps the captured rules in
[`docs/rules/rules.md`](rules/rules.md) to concrete Jobbbler evidence. The
status separates what the repository proves from deployment, media, and live
browser checks that must be recorded for the final submitted revision. The
live rules and submission form are rechecked immediately before submission.

| Requirement                                               | Jobbbler evidence                                                                                                                                          | Evidence status                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| New or meaningfully extended during the submission period | Repository baseline begins on 29 August 2026; implementation uses dated commits after the 25 August start                                                  | Verified in repository                               |
| WebMCP-powered web app                                    | Imperative `document.modelContext.registerTool` integration with the same 29 tools on every route, shared UI state, activity feedback, and lifecycle tests | Repository verified; live browser check pending      |
| Working and consistent with video/text                    | The production smoke suite, final browser walkthrough, and media plan require the same deployed revision                                                   | Pending production and media evidence                |
| Authorized third-party SDK/API/data use                   | Source-policy registry, official job-feed endpoints, attribution, bounded polling, and first-party synthetic fallback                                      | Repository verified; production source check pending |
| Accessible live URL                                       | Search is designed for signed-out access without payment or a mandatory account                                                                            | Pending production signed-out smoke                  |
| Strong WebMCP explanation                                 | English project story and README explain why the browser-local semantic layer improves discovery, monitoring, and reviewed applications                    | Verified in repository                               |
| Public source repository                                  | Source, lockfile, migrations, instructions, and MIT license are public                                                                                     | Repository verified; final revision pending          |
| Required WebMCP code visible                              | Registration implementation and capability evidence are linked from README                                                                                 | Repository verified; default-branch sync pending     |
| Demo video under three minutes with audio                 | The checked-in storyboard targets 2:40 and puts working WebMCP near the beginning                                                                          | Pending final video, duration, and audio check       |
| No unlicensed media or trademarks                         | Product UI is original; source names are used only as factual attribution                                                                                  | Repository verified; final media review pending      |
| Free judging access through judging period                | Public search and the loginless owner-session design require no payment or demo account                                                                    | Pending production availability check                |
| English submission materials                              | Checked-in UI, README, story, instructions, captions, and narration are English                                                                            | Repository verified; final form/media check pending  |
| Original submission and IP ownership                      | Original design system and implementation; dependency licenses retained                                                                                    | Verified in repository                               |
| Stage-one viability                                       | Coherent conventional UI, durable backend, and non-trivial WebMCP implementation                                                                           | Repository verified; final release gates pending     |
| WebMCP Leverage                                           | Search, compare, alerts, applications, route lifecycle, visible feedback, and model evaluation fixtures                                                    | Repository verified; live browser proof pending      |
| Human-controlled agent authority                          | Resource/action/expiry-bound delegations, request-bound decisions, backend re-evaluation, revoke, and denied-retry tests                                   | Repository verified; live journey pending            |
| Consent and privacy by design                             | Granular data grants, exact recipient/purpose/payload binding, withdrawal, redaction, and public architecture                                              | Repository verified; live journey pending            |
| Observable agent interaction                              | Redacted cursor activity, point-of-effect feedback, optional Supabase wake-up broadcasts, reconnect/refetch semantics, and polling fallback                | Repository verified; production transport pending    |
| Execution                                                 | Conventional UI, worker, storage adapters, scheduler, notifications, security controls, and observability contracts                                        | Repository verified; production smoke pending        |
| Potential Impact                                          | Focused IT/adjacent-tech audience; explainable discovery and safer applications                                                                            | Verified in repository narrative                     |
| Creativity and Ambition                                   | Agent-native web workflow without separate MCP setup, durable alerts, and human-confirmed actions                                                          | Repository verified; final demo pending              |

## Product separation

Jobbbler is the only product in this repository and submission. It covers IT and adjacent-technology vacancies. Local Services is a distinct future product; if built for the challenge, it must have a separate product identity, repository context, case study, story, media package, live URL, and Devpost submission.

## Current known deadline

The locally captured rules state 3 September 2026 at 1:00 pm Pacific Time. Devpost displays the localized equivalent in the authenticated UI. Because rules may change, the live rules and submission form remain the final source of truth.
