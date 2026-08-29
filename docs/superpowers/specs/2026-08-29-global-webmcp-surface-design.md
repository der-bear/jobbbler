# Global WebMCP Surface Design

## Objective

Jobbbler must let an external browser agent begin any supported user outcome from any page without guessing DOM controls or becoming stranded after navigation. The visible site remains a simple technology-job portal, while the Agent panel remains the judge-facing proof of the underlying WebMCP interaction.

## Decision

Register one stable set of 24 focused tools on every Jobbbler document,
including informational and malformed routes. Route, owner, draft, and stage
requirements are enforced by each tool when it executes. This follows the
product requirement that an external agent should never need to navigate in
order to discover a capability, while the reduced outcome-oriented inventory
avoids overlapping lifecycle primitives.

## Site-wide core

The following tools are the six clearest entry points across navigation:

- `plan_job_workflow`: explains safe, goal-oriented compositions.
- `get_search_filters`: returns the accepted filter vocabulary.
- `search_jobs`: performs a public search and opens the canonical results URL.
- `open_job_details`: opens a known Jobbbler role from any page.
- `prepare_application`: creates or reopens one owner-bound private draft for a chosen role.
- `open_jobbbler_page`: opens Search, Saved, Comparison, or an existing Application workspace with validated identifiers.

The registration provider deduplicates tools by name and keeps all search,
detail, comparison, saved-search, and application outcomes registered. The
Guide and catalog group them by product area for people; agents receive the
same stable list on every route.

## Context and safety

- Read-only public data tools may be globally callable.
- Navigation tools declare `readOnlyHint: false` because they change the visible page.
- Owner and application tools remain server-authorized on every execution.
- Application mutation tools remain owner- and stage-gated at execution.
- Assistance authorization and the exact submission decision remain separate
  `requires_user_action` transitions in the external agent client, bound to
  exact server requests.
- Tool results stay within the existing 1.5 KB budget and never include raw source HTML, reusable credentials, full email addresses, or private payloads.

## Agent panel

The panel communicates one unambiguous quantity: the 24 tools discoverable
across Jobbbler. It groups them by outcome and explains that private actions
still require an owned draft and the correct stage.

Activity leads with a human-readable effect and keeps the tool name, status,
duration, and read/write classification as compact technical evidence. Tools
shows every capability without extra navigation. Guide presents the external
agent workflow, a self-contained copyable prompt with the site URL, and the
human boundaries without becoming protocol documentation.

The panel uses a restrained editorial layout: one boundary, one signal color, no nested card grid, no chat bubbles, and monospace only for tool identifiers. The panel is resizable on desktop and becomes a labeled drawer on narrow screens. All tabs, resize controls, status changes, and motion must remain keyboard and screen-reader usable. Motion is disabled under `prefers-reduced-motion`.

## Brand behavior

Branding expresses `signal over noise` through typography, whitespace, one evergreen/mint signal accent, and one short pulse when a real agent call updates visible state. There are no decorative particles, AI spheres, avatars, embedded chat, or continuous animation.

## Verification

- Unit tests validate catalog completeness, unique names, navigation inputs, result size, annotations, and route/context classification.
- The live WebMCP E2E test asserts the same 24 tools on Search, Role, Saved,
  About, and Application routes.
- The E2E journey calls `search_jobs` from a non-search page and verifies the URL, visible results, panel activity, and re-registration.
- Accessibility verification covers keyboard traversal, tabs, focus visibility, labels, live regions, reduced motion, responsive reflow, and automated axe checks.
- Release verification runs formatting, lint, typecheck, unit suites, production build, WebMCP E2E, accessibility checks, and production smoke.

## Non-goals

- A separate MCP server or MCP App.
- A generic `execute` tool.
- Global application authority; global discovery is not authorization.
- A second in-site agent chat.
- Qualification-tier expansion before release.
