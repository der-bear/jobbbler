# OpenAI WebMCP Challenge Compliance

This checklist maps the captured rules in
[`docs/rules/rules.md`](rules/rules.md) to concrete Jobbbler evidence. The
status separates what the repository proves from deployment, media, and live
browser checks that must be recorded for the final submitted revision. The
live rules and submission form are rechecked immediately before submission.

| Requirement                                               | Jobbbler evidence                                                                                                                                          | Evidence status                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| New or meaningfully extended during the submission period | Repository baseline begins on 29 August 2026; implementation uses dated commits after the 25 August start                                                  | Verified in repository                                                   |
| WebMCP-powered web app                                    | Imperative `document.modelContext.registerTool` integration with the same 29 tools on every route, shared UI state, activity feedback, and lifecycle tests | Repository and supported local browser verified; production pending      |
| Working and consistent with video/text                    | The production smoke suite, final browser walkthrough, and media plan require the same deployed revision                                                   | Pending production and media evidence                                    |
| Authorized third-party SDK/API/data use                   | The submitted catalog is first-party synthetic data; optional external connectors remain policy-controlled and disabled in the release worker              | Repository verified; production catalog smoke pending                    |
| Accessible live URL                                       | Search is designed for signed-out access without payment or a mandatory account                                                                            | Pending production signed-out smoke                                      |
| Strong WebMCP explanation                                 | English project story and README explain why the browser-local semantic layer improves discovery, monitoring, and reviewed applications                    | Verified in repository                                                   |
| Public source repository                                  | Source, lockfile, migrations, instructions, and MIT license are public                                                                                     | Repository verified; final revision pending                              |
| Required WebMCP code visible                              | Registration implementation and capability evidence are linked from README                                                                                 | Repository verified; default-branch sync pending                         |
| Demo video under three minutes with audio                 | The checked-in storyboard targets 2:40 and puts working WebMCP near the beginning                                                                          | Pending final video, duration, and audio check                           |
| No unlicensed media or trademarks                         | Product UI is original; source names are used only as factual attribution                                                                                  | Repository verified; final media review pending                          |
| Free judging access through judging period                | Public search and the loginless owner-session design require no payment or demo account                                                                    | Pending production availability check                                    |
| English submission materials                              | Checked-in UI, README, story, instructions, captions, and narration are English                                                                            | Repository verified; final form/media check pending                      |
| Original submission and IP ownership                      | Original design system and implementation; dependency licenses retained                                                                                    | Verified in repository                                                   |
| Stage-one viability                                       | Coherent conventional UI, durable backend, and non-trivial WebMCP implementation                                                                           | Local release gates verified; production pending                         |
| WebMCP Leverage                                           | Search, compare, alerts, applications, route lifecycle, visible feedback, and model evaluation fixtures                                                    | Repository and supported local browser verified; production demo pending |
| Human-controlled agent authority                          | Resource/action/expiry-bound delegations, request-bound decisions, backend re-evaluation, revoke, and denied-retry tests                                   | Repository verified; live journey pending                                |
| Consent and privacy by design                             | Granular data grants, exact recipient/purpose/payload binding, withdrawal, redaction, and public architecture                                              | Repository verified; live journey pending                                |
| Observable agent interaction                              | Redacted cursor activity, point-of-effect feedback, optional Supabase wake-up broadcasts, reconnect/refetch semantics, and polling fallback                | Repository verified; production transport pending                        |
| Execution                                                 | Conventional UI, worker, storage adapters, scheduler, notifications, security controls, and observability contracts                                        | Repository verified; production smoke pending                            |
| Potential Impact                                          | Focused IT/adjacent-tech audience; explainable discovery and safer applications                                                                            | Verified in repository narrative                                         |
| Creativity and Ambition                                   | Agent-native web workflow without separate MCP setup, durable alerts, and human-confirmed actions                                                          | Repository verified; final demo pending                                  |

## Product separation

Jobbbler is the only product in this repository and submission. It covers IT and adjacent-technology vacancies. Local Services is a distinct future product; if built for the challenge, it must have a separate product identity, repository context, case study, story, media package, live URL, and Devpost submission.

## Kickoff scope disposition

The preserved kickoff is an explored shared-engine specification, not the
release contract. The challenge release makes these deliberate, testable
choices:

| Kickoff direction                             | Release decision                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jobs and Local Services as separate verticals | Ship Jobs as the coherent first product; keep Local Services out of this repository and submission                                                    |
| Route- and state-varying WebMCP registration  | Register one stable 29-tool vocabulary on every route; enforce ownership and workflow state when a tool executes                                      |
| Multiple live job feeds                       | Keep three governed connector implementations and offline fixtures, but disable every live-source policy so the release uses only 300 fictional roles |
| Optional platform AI tier                     | Keep language understanding and drafting in the visiting external agent; Jobbbler remains the deterministic data, workflow, and authority layer       |
| SQLite first, Supabase later                  | Preserve SQLite for zero-service development and validate the same repository contracts, migrations, RLS, and 300-role catalog in Supabase PostgreSQL |
| Several application adapters                  | Ship the Jobbbler-managed application path first; keep partner ATS and external handoff modes outside the public release workflow                     |

## Current release evidence

The fresh 2 September 2026 release-candidate check on the current tree
recorded:

- `pnpm verify`: formatting, lint, every workspace typecheck, 975 deterministic
  tests, and both production builds passed;
- Playwright: 50/50 browser journeys passed, including the complete
  agent-prepared application flow, saved-search schedules, location
  autocomplete, keyboard navigation, responsive layouts, and reduced motion;
- the release SQLite database contained exactly 300 `jobbbler_demo` roles and
  its backup/restore integrity check passed with the same 300-role catalog;
- live WebMCP in the supported in-app browser: the same 29 unique tools stayed
  discoverable before and after real navigation. `search_jobs` applied a
  Platform + Remote + Newest request to the visible URL and returned 61 matches
  with three bounded results; `open_job_details` opened one of those roles;
  `get_job_details` returned its source-backed record; and a warm
  `open_jobbbler_page` call returned to search without losing a tool;
- low-effort model review: Luna evaluated 50 realistic intents (43 immediate
  safe routes and seven clarification- or state-sensitive cases); Terra
  evaluated 10 multi-step journeys and exposed three guidance gaps that drove
  the saved-state pagination, workflow, and cursor/UI clarification changes;
- production dependency audit: no known production vulnerabilities;
- design-system contracts keep normal text and action states at WCAG AA
  contrast in both themes, prohibit two-pixel component borders, and route
  compact typography, radii, and frosted materials through shared tokens.

The infrastructure rehearsal on 1 September 2026 additionally recorded:

- isolated clean-context Docker builds for both release targets; the web and
  worker runtime images use Node 24, run as the non-root `jobbbler` user (UID
  1001), and the worker image contains both migration sets through PostgreSQL
  `0019` and SQLite `0025`;
- PostgreSQL: 103/103 repository, concurrency, migration, and RLS contract
  tests passed in a disposable local database that was removed after the run;
- read-only Supabase inspection: all 19 checked-in PostgreSQL migrations are
  present, the `jobbbler` schema contains 300 demo roles, RLS is enabled on its
  tables, and the security advisor reports no findings.

These checks prove the current code and prepared database state. They do not
replace the required smoke test on the eventual public deployment or the final
video and Devpost checks.

## Current known deadline

The locally captured rules state 3 September 2026 at 1:00 pm Pacific Time. Devpost displays the localized equivalent in the authenticated UI. Because rules may change, the live rules and submission form remain the final source of truth.
