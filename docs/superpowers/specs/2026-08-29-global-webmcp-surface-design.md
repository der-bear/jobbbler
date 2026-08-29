# Global WebMCP Surface Design

## Objective

Jobbbler must let an external browser agent begin any supported user outcome from any page without guessing DOM controls or becoming stranded after navigation. The visible site remains a simple technology-job portal, while the Agent panel remains the judge-facing proof of the underlying WebMCP interaction.

## Decision

Use a two-layer registration model:

1. A stable site-wide core is registered on every Jobbbler document, including informational and malformed routes.
2. Context tools are added when the current route, owner session, application draft, and workflow stage make them useful and authorized.

This gives every page global workflow reachability without registering every state-changing application primitive when no matching draft, review, permission request, or confirmation exists. Literal registration of every primitive everywhere would consume model context, create overlapping choices, and weaken the product's capability boundary.

## Site-wide core

The following tools remain registered across navigation:

- `plan_job_workflow`: explains safe, goal-oriented compositions.
- `get_site_capabilities`: returns the complete compact catalog, current availability, route requirements, and human boundaries.
- `get_search_filters`: returns the accepted filter vocabulary.
- `search_jobs`: performs a public search and opens the canonical results URL.
- `open_job_details`: opens a known Jobbbler role from any page.
- `open_jobbbler_page`: opens Search, Saved, Comparison, or an existing Application workspace with validated identifiers.

The registration provider deduplicates tools by name. Search therefore adds only `get_search_state`; other routes add their useful detail, comparison, saved-search, or application tools.

## Context and safety

- Read-only public data tools may be globally callable.
- Navigation tools declare `readOnlyHint: false` because they change the visible page.
- Owner and application tools remain server-authorized on every execution.
- Application mutation tools remain stage-gated. The global catalog says how to reach them but never pretends they are currently executable.
- Consent and final confirmation remain separate `requires_user_action` transitions bound to exact server requests.
- Tool results stay within the existing 1.5 KB budget and never include raw source HTML, reusable credentials, full email addresses, or private payloads.

## Agent panel

The panel communicates three different quantities instead of one ambiguous count:

- core tools available everywhere;
- context tools available now;
- total capabilities in the site catalog.

Activity leads with a human-readable effect and keeps the tool name, status, duration, and read/write classification as compact technical evidence. Tools separates `Always available` from `Available in this context`. Guide presents outcome workflows, not a wall of protocol documentation.

The panel uses a restrained editorial layout: one boundary, one signal color, no nested card grid, no chat bubbles, and monospace only for tool identifiers. The panel is resizable on desktop and becomes a labeled drawer on narrow screens. All tabs, resize controls, status changes, and motion must remain keyboard and screen-reader usable. Motion is disabled under `prefers-reduced-motion`.

## Brand behavior

Branding expresses `signal over noise` through typography, whitespace, one evergreen/mint signal accent, and one short pulse when a real agent call updates visible state. There are no decorative particles, AI spheres, avatars, embedded chat, or continuous animation.

## Verification

- Unit tests validate catalog completeness, unique names, navigation inputs, result size, annotations, and route/context classification.
- The live WebMCP E2E test asserts the same core tools on Search, Role, Saved, About, and Application routes; context tools must change without removing the core.
- The E2E journey calls `search_jobs` from a non-search page and verifies the URL, visible results, panel activity, and re-registration.
- Accessibility verification covers keyboard traversal, tabs, focus visibility, labels, live regions, reduced motion, responsive reflow, and automated axe checks.
- Release verification runs formatting, lint, typecheck, unit suites, production build, WebMCP E2E, accessibility checks, and production smoke.

## Non-goals

- A separate MCP server or MCP App.
- A generic `execute` tool.
- Global application authority.
- A second in-site agent chat.
- Qualification-tier expansion before release.
