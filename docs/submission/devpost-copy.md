# Devpost copy — Jobbbler

## Project name

Jobbbler

## Tagline

A familiar job portal that becomes agent-operable the moment a browser agent opens it.

## Overview

Jobbbler is a proof of value for the agentic web. It turns a noisy job search into a private, reviewable workflow: discover technology roles, compare evidence, save a signal, receive a verified alert, and prepare one deliberate application. It works as a simple conventional website, while a compatible browser agent can open the same URL, automatically discover the tools relevant to that page, and act without a separately installed or declared MCP server.

## The problem

Work is changing quickly, and people repeatedly perform the same expensive search every day: scan new listings, rebuild filters, compare incomplete facts, remember what changed, and decide where to apply. Conventional automation hides context or requires custom integrations. People need an agent to do the repetitive work across a data-rich platform without surrendering their identity, application data, or final decision.

## Inspiration

WebMCP is an important step toward an agentic web in which a website can explain its useful actions directly to the visiting browser agent. We chose jobs because the value is immediately understandable: the data changes daily, the search is repetitive, and the path from discovery to application contains meaningful trust boundaries. Jobbbler is one concrete example of a broader pattern that can apply to knowledge bases, marketplaces, and other data-rich products.

## How we built it

Jobbbler is a TypeScript monorepo with a Next.js web app, domain packages, portable SQLite/PostgreSQL storage adapters, connector workers, and an accessible shared UI system. Its catalog normalizes policy-controlled job records and retains source evidence. Route-scoped WebMCP tools are registered only where they are useful: search and compare on discovery views, alert tools in Saved, and state-dependent tools during an application. Navigation removes stale tools. The visible interface and WebMCP are two adapters over the same server commands, so the URL, filters, results, alerts, permissions, and receipts remain consistent.

WebMCP capability is live while the page is open; durable alerts are an honest server-side continuation, not a claim that the browser agent remains alive. Alerts evaluate saved-search changes deterministically, queue idempotent deliveries, and require a verified email endpoint.

The application flow separates a draft, validation and immutable review, agent delegation, data permission, short-lived confirmation, and idempotent receipt. When permission is needed, the agent client receives the exact recipient, purpose, categories, fields, notice, and server request ID. A separate confirmation tool records the explicit agent-mediated action. The receipt is useful evidence, but it deliberately does not claim cryptographic human or agent-vendor identity. Sensitive values and raw chat stay out of tool results and stored consent evidence.

## Challenges we ran into

- Making browser-agent help meaningful without making WebMCP a decorative wrapper around ordinary endpoints.
- Keeping the app useful when WebMCP is unavailable, still preparing, or fails to register.
- Separating a helpful agent suggestion from authorization to read data, mutate a draft, or submit an application.
- Building alert scheduling, retries, and delivery identity so a refresh or worker retry does not produce duplicate notifications.
- Showing operational truth in a compact activity rail without exposing identifiers, email addresses, raw source payloads, or secrets.

## Accomplishments we are proud of

- A real, route-relevant WebMCP surface instead of one generic “assistant” button.
- A zero-configuration website encounter: the agent opens Jobbbler and discovers the active page's actions without a separate MCP-server declaration.
- Search, comparison, saved alerts, and an internal demo application form connect into one coherent journey.
- Optional Agent Activity and browser capability state make tool work understandable without turning the portal into a developer console.
- Progressive identity and verified-email alerts preserve a low-friction start while supporting durable ownership.
- Request-bound, agent-mediated permission receipts connect client-side consent UX to an exact server record without overstating identity assurance.
- Explicit delegation, immutable review, and one-time confirmation keep final application actions controlled.
- Source-aware job ingestion, safe normalized data, and focused domain/storage/worker tests create an auditable foundation.

## What we learned

Agent UX improves when a site exposes a small vocabulary of outcome-level actions and makes their effects legible. Small boundaries matter: browser capability is not authorization; WebMCP is not a background worker; an agent-mediated affirmative action is evidence but not cryptographic identity; a saved search is not permission to notify an unverified endpoint; and a reviewed application is not confirmation to submit. A strong non-agent fallback makes WebMCP more credible because the tool layer augments a working product rather than disguising a missing workflow.

## What’s next

- Observe production tool use and refine route vocabularies from real user requests.
- Broaden connector coverage under explicit source policies and freshness monitoring.
- Add more user-controlled alert channels after the same verification and consent model is in place.
- Continue testing WebMCP behavior across supported browser contexts and refine route tools from observed user workflows.

## Technologies used

TypeScript, Next.js, React, WebMCP/browser model context, Zod, Vitest, pnpm workspaces, SQLite, PostgreSQL/Supabase adapter, Node.js workers, AES-256-GCM email envelopes, Resend-compatible email delivery, and a custom CSS token system.

## Resources

- Live project: **[PRODUCTION_URL — replace before submission]**
- Demo video: **[VIDEO_URL — replace before submission]**
- Source repository: **[REPOSITORY_URL — replace before submission]**
- WebMCP capability notes: `docs/architecture/webmcp-capability-matrix.md`

## Privacy and safety

Jobbbler starts without a public profile. Email alerts use verified endpoints; encrypted email envelopes are decrypted only server-side for delivery. WebMCP registration and a draft identifier do not grant an agent permission to act. Delegation is resource-scoped and revocable. Data grants bind the owner session, agent session, reviewed payload, recipient, purpose, fields, notice, request ID, channel, and affirmative action; no raw chat is retained. An application still needs review plus a short-lived single-use confirmation. Tool activity and safe errors avoid raw PII, secrets, reusable tokens, and raw source HTML.

## Open source and local run

License and public repository status: **[VERIFY_AND_LINK_BEFORE_SUBMISSION]**.

Local run instructions: **[REPOSITORY_URL]/README.md** — verify this link, the documented command, required environment variables, and a clean first-run flow before publishing.
