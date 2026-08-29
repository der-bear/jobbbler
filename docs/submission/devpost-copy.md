# Devpost copy — Jobbbler

## Project name

Jobbbler

## Tagline

An evidence-first job workspace where people and browser agents collaborate without giving up control.

## Overview

Jobbbler turns a noisy job search into a private, reviewable workflow: discover roles, compare the evidence, save a signal, receive a verified alert, and prepare a deliberate application. It works as a conventional web app, then becomes faster when a WebMCP-capable browser agent can use the tools relevant to the route a person is viewing.

## The problem

Searching for technical work is fragmented. Listings are duplicated, their context disappears between tabs, and automation can make consequential actions feel opaque. People need help narrowing options and keeping watch, but they should not have to surrender identity, application data, or the final decision to an agent.

## Inspiration

We wanted to treat an agent as a well-instrumented collaborator, not an invisible autopilot. The useful moment is not merely an agent returning a search result. It is seeing the relevant tool run, understanding what changed, choosing whether to create a durable alert, and keeping a human confirmation boundary around an application.

## How we built it

Jobbbler is a TypeScript monorepo with a Next.js web app, domain packages, SQLite/PostgreSQL storage adapters, connector workers, and an accessible shared UI system. Its catalog normalizes records from policy-controlled job sources and retains source evidence. Route-scoped WebMCP tools are registered only where they are useful: search and compare on discovery views, alert tools in Saved, and application tools in the application flow. The interface shows WebMCP readiness and Agent Activity so tool execution is visible rather than hidden.

Alerts evaluate saved-search changes deterministically, queue idempotent deliveries, and require a verified email endpoint. The application flow separates a draft, validation/review, consent and delegation records, a short-lived confirmation, and an idempotent receipt. Sensitive values stay server-side; the browser agent receives bounded, safe tool input and output rather than reusable credentials.

## Challenges we ran into

- Making browser-agent help meaningful without making WebMCP a decorative wrapper around ordinary endpoints.
- Keeping the app useful when WebMCP is unavailable, still preparing, or fails to register.
- Separating a helpful agent suggestion from authorization to read data, mutate a draft, or submit an application.
- Building alert scheduling, retries, and delivery identity so a refresh or worker retry does not produce duplicate notifications.
- Showing operational truth in a compact activity rail without exposing identifiers, email addresses, raw source payloads, or secrets.

## Accomplishments we are proud of

- A real, route-relevant WebMCP surface instead of one generic “assistant” button.
- Search, comparison, saved alerts, and an internal demo application form connect into one coherent journey.
- Visible Agent Activity and browser capability state make asynchronous work understandable.
- Progressive identity and verified-email alerts preserve a low-friction start while supporting durable ownership.
- Explicit delegation, consent, immutable review, and one-time confirmation keep final application actions human-controlled.
- Source-aware job ingestion, safe normalized data, and focused domain/storage/worker tests create an auditable foundation.

## What we learned

Agent UX improves when the product makes state changes legible at the point of effect. Small boundaries matter: browser capability is not authorization; a saved search is not permission to notify an unverified endpoint; a reviewed application is not confirmation to submit. We also learned that a strong non-agent fallback makes WebMCP more credible, because it demonstrates that the tool layer augments a working product rather than disguises a missing workflow.

## What’s next

- Deploy and monitor the supported production storage/worker stack.
- Broaden connector coverage under explicit source policies and freshness monitoring.
- Add more user-controlled alert channels after the same verification and consent model is in place.
- Continue testing WebMCP behavior across supported browser contexts and refine route tools from observed user workflows.

## Technologies used

TypeScript, Next.js, React, WebMCP/browser model context, Zod, Vitest, pnpm workspaces, SQLite, PostgreSQL adapter, Node.js workers, AES-256-GCM email envelopes, Resend-compatible email delivery, and a proprietary CSS/UI token system.

## Resources

- Live project: **[PRODUCTION_URL — replace before submission]**
- Demo video: **[VIDEO_URL — replace before submission]**
- Source repository: **[REPOSITORY_URL — replace before submission]**
- WebMCP capability notes: `docs/architecture/webmcp-capability-matrix.md`

## Privacy and safety

Jobbbler starts without a public profile. Email alerts use verified endpoints; encrypted email envelopes are decrypted only server-side for delivery. WebMCP registration and a draft identifier do not grant an agent permission to act. Delegation is resource-scoped and revocable, data grants are purpose-bound, and an application still needs review plus a short-lived human confirmation. Tool activity and safe errors avoid raw PII, secrets, reusable tokens, and raw source HTML.

## Open source and local run

License and public repository status: **[VERIFY_AND_LINK_BEFORE_SUBMISSION]**.

Local run instructions: **[REPOSITORY_URL]/README.md** — verify this link, the documented command, required environment variables, and a clean first-run flow before publishing.
