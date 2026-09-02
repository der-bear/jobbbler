# OpenAI WebMCP Challenge evidence

Jobbbler is a complete job-search product with a conventional interface and a
browser-native WebMCP layer. The ordinary site works without an agent. In a
supported browser agent, the same live page exposes 29 focused tools for
finding roles, comparing evidence, monitoring a saved search, and preparing a
reviewed application.

## Judge path

1. Open [jobbbler.com](https://jobbbler.com) signed out. The fictional
   300-role catalog, filters, saved searches, applications, privacy controls,
   and product guide require no paid account.
2. In the ChatGPT Desktop built-in browser with a WebMCP-capable model, inspect
   Site tools. Jobbbler registers the same 29 tools on every route.
3. Ask the agent to find and compare roles. `search_jobs` synchronizes the
   visible URL, filters, results, and Agent activity while compact read tools
   return source-backed evidence without unnecessary page changes.
4. Ask it to keep watching the search or prepare an application. Jobbbler
   works autonomously until an email, personal-data permission, or final
   submission decision belongs to the person; then the agent client presents
   the exact request-bound review.

The [WebMCP evaluation evidence](architecture/webmcp-evals.md) contains the
verified prompts, expected tool sequences, client boundary, and model-review
results. The [capability matrix](architecture/webmcp-capability-matrix.md) maps
the browser proposal to implementation, tests, failure handling, and visible
proof.

## Evaluation evidence

| Dimension               | What Jobbbler demonstrates                                                                                                                                                       | Where to inspect it                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebMCP leverage         | One stable, route-independent 29-tool vocabulary; bounded schemas and results; shared commands keep agent and page state aligned                                                 | [`packages/webmcp`](../packages/webmcp), [`webmcp-provider.tsx`](../apps/web/src/components/webmcp-provider.tsx), [capability matrix](architecture/webmcp-capability-matrix.md) |
| Execution               | Production Next.js BFF, portable domain and storage contracts, Supabase PostgreSQL, lease-based worker, Resend delivery, recovery, redacted activity, and tested degraded states | [architecture](architecture/README.md), [operations](operations.md), [security](security.md)                                                                                    |
| Potential impact        | A person delegates repetitive discovery and monitoring, while the agent returns only for missing facts and consequential decisions                                               | [product experience](design/product-experience.md), [consent architecture](architecture/agent-authorization-and-consent.md)                                                     |
| Creativity and ambition | The website becomes the agent interface without a separately configured MCP server; durable work continues honestly on Jobbbler's server after the tab closes                    | [realtime activity](architecture/realtime-agent-activity.md), [evaluation evidence](architecture/webmcp-evals.md)                                                               |

## Deliberate release scope

- The release is one coherent product for IT and adjacent-technology roles.
- All 300 roles and 30 organizations are first-party fictional demo data.
  Checked-in live-source policies are disabled, so production does not mix in
  third-party vacancies.
- Language understanding and drafting stay with the visiting agent. Jobbbler
  is the deterministic data, workflow, authority, and audit layer.
- SQLite is the zero-service local default. Production uses the same repository
  contracts and migrations through Supabase PostgreSQL.
- Every demo role uses the Jobbbler-managed application path. Unsupported ATS
  handoffs are outside the public workflow.

## Verified release

The 2 September 2026 release candidate passed:

- formatting, lint, all workspace typechecks, 991 deterministic tests, and the
  production web and worker builds through `pnpm verify`;
- 50 browser journeys covering search, pagination, location autocomplete,
  saved-search schedules, the complete agent-prepared application path,
  keyboard use, responsive layouts, and reduced motion;
- 103 PostgreSQL repository, concurrency, migration, and RLS contract tests in
  a disposable database;
- production readiness with 19 PostgreSQL migrations, 30 organizations, and
  exactly 300 `jobbbler_demo` roles;
- all 29 tools discovered across real navigation in the supported ChatGPT
  Desktop browser, plus the Chrome Model Context Tool Inspector as a separate
  developer verification surface;
- a real scheduled alert cycle and delivered verification email on the
  configured production transports;
- 50 low-effort Luna routing evaluations and 10 Terra multi-step evaluations;
- no known production dependency vulnerabilities and no Supabase security
  advisor findings.

The catalog is intentionally fictional and labelled as such. No real candidate
data, employer submission, or production mailbox secret is required to review
the project.
