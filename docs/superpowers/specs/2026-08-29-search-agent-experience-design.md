# Jobbbler Search and Agent Experience Design

**Date:** 2026-08-29  
**Status:** Approved direction; implementation specification  
**Scope:** Public navigation, landing and search states, location assistance,
salary presentation, Agent view, WebMCP explainer, visual identity, and motion

## Purpose

Jobbbler must feel like an unusually clear technology-job portal to an ordinary
person and like an unusually complete WebMCP proof to a challenge judge. The
technology stays under the surface until someone opens the judge-facing Agent
view. Every visible word, boundary, emphasis, and transition must either help a
person find work or help a judge verify what the agent did.

The target is restrained editorial minimalism with one memorable signature:
precise green light and motion that follows real state changes. The product must
look strong in a still image and become more expressive during a recorded agent
workflow without relying on ornamental animation.

## Design principles

1. **A job portal first.** Outside Agent view, use familiar job-search language
   and controls. Do not expose implementation vocabulary.
2. **Two states, one search.** The landing state helps someone begin. The
   results state helps them refine. Do not force both information densities into
   the same screen.
3. **Hierarchy before decoration.** Typography, whitespace, alignment, and
   contrast carry the interface. Brand effects are sparse and functional.
4. **Observable, not theatrical.** Motion communicates a real transition,
   agent action, loading state, or change of context. Nothing moves forever.
5. **Capabilities match state.** A small outcome-level WebMCP core remains
   available everywhere. Contextual tools exist only where they are valid.
6. **Unknown remains unknown.** Missing salary, source, or authorization state
   is never inferred for visual convenience.

## Information architecture

### Header

- Show the `Jobbbler` wordmark without the long inline tagline.
- Rename primary destinations to `Jobs` and `Alerts`. `Alerts` is accurate for
  saved searches and avoids implying that the product bookmarks individual
  roles.
- Replace the `Works with agents` link and separate floating trigger with one
  compact `Agent view` toggle near the theme control. A status dot communicates
  readiness without adding a sentence to the header.
- The toggle uses `aria-expanded`, names its current state, and remains reachable
  in every route and viewport.

### Landing state

The root URL with no meaningful search criteria is the start screen.

- Lead with `Find your next technology role` and one short supporting sentence.
- Present role/skill/company and location as distinct fields with one `Search`
  action.
- Do not show the refinement rail.
- Show a small `Latest roles` section after the search area. It contains no more
  than six high-quality rows or cards and one path to the full catalog.
- Keep the Agent view available without letting it compete with the primary
  search task.

### Results state

Any meaningful query or filter switches the same route into a denser results
workspace.

- Condense the landing search into a slim search bar above the workspace.
- Keep role and location in this bar because both are primary search intent;
  do not duplicate location in the filter rail.
- Show the refinement rail only in this state.
- Preserve URL-addressable criteria, browser history, and the existing WebMCP
  UI bridge.
- Results keep a document-like rhythm rather than becoming a grid of decorative
  cards.

## Search controls

### Location assistance

Location is an editable ARIA combobox, not a closed country selector.

- Suggestions come from locations present in the catalog plus useful scopes
  such as `Remote`, `Global`, and `Europe`.
- Matching is case-insensitive and begins after meaningful input.
- People may enter a city, country, region, or their own text even when it is
  not in suggestions.
- Keyboard behavior follows combobox conventions: arrow navigation, Enter to
  choose, Escape to close, and visible active-option state.
- The input exposes a clear affordance only when it contains a value.
- On mobile, the role and location controls stack as separate full-width rows.

### Filters

- Work model remains the fastest choice and uses compact neutral pills.
- Function and seniority remain searchable multi-selects.
- Date posted remains a plain select.
- Minimum salary keeps the slider but replaces the currency dropdown with an
  accessible segmented selector for EUR, USD, GBP, and CAD.
- Exclusions remain an advanced plain-text field with an example.
- Active filters remain removable and URL-addressable.

## Result hierarchy and salary

Each result communicates, in order:

1. role title;
2. organization;
3. work model and location;
4. compensation;
5. freshness.

The title is the only large emphasis. Compensation uses a stronger weight but
does not compete with the title. Work model receives a small neutral outline
label; it is never encoded by color alone. Location stays plain text.

All disclosed compensation is presented in the selected display currency.

- Reuse the domain's deterministic EUR/USD/GBP/CAD conversion function.
- Preserve the original period (`year`, `month`, or `hour`).
- Prefix converted values with `≈` and provide an accessible explanation of the
  original currency.
- Detail views retain original compensation and source evidence.
- Undisclosed compensation reads `Salary not listed`; Jobbbler never fabricates
  a range.
- Improve the fictional demo catalog's disclosed-salary coverage so the demo is
  informative while retaining several truthful unknown examples.

## Agent view

The Agent view is a judge/developer proof surface, not part of the ordinary job
task.

### Structure

Use the order `Activity`, `Tools`, `Guide`.

- `Activity` is the default on first open.
- A new real tool execution may mark Activity unread, but must not override a
  tab the person explicitly selected.
- The panel remains a resizable side surface on wide screens and a focus-trapped
  modal drawer on narrow screens.
- Closing restores focus to `Agent view`; Escape closes the drawer.

### Activity

The empty state contains only:

- `Waiting for an agent`;
- one sentence explaining that WebMCP tool calls and their visible results will
  appear here;
- one concise example prompt that can be copied.

Receipts lead with a human outcome, followed by tool identifier, status, and
duration. Avoid timestamps, nested disclosures, duplicated status labels, and
raw identifiers. Loading, approval-needed, success, cancellation, and failure
states each have clear human copy.

### Tools

The tab contains the complete 24-tool catalog without navigating away.

- Show `Available tools`, grouped by Find, Inspect and compare, Alerts, and
  Apply. The same set is discoverable on every route.
- Each row contains a human title, code identifier, Read/Action metadata, and a
  one-sentence purpose.
- Active tools are visually marked without suggesting that inactive tools are
  broken.
- Remove `View all tools` and any link used only to repeat this catalog.

### Guide

Keep the guide concise but sufficient:

1. no separate MCP server or connector setup;
2. one self-contained example prompt that includes the current Jobbbler URL;
3. the three-step external agent flow;
4. what the tools handle and what decisions stay with the person.

Do not repeat the product story, tool catalog, or capability groups here.

## WebMCP registration model

Keep the stable global model established by the global WebMCP surface design.

- Register all 24 focused tools on every Jobbbler route.
- Enforce route, explicit ID, owner, and workflow-stage requirements at
  execution time.
- Keep `plan_job_workflow` advisory and optional; direct tool descriptions
  remain sufficient for ordinary requests.
- Let the Agent view group the catalog by outcome and explain that global
  discovery is not global authority.

The 24-tool limit is deliberate: lifecycle primitives were consolidated into
outcome tools and the redundant capability dump was removed. This keeps the
user requirement of global discovery without overlapping choices or a generic
execute tool.

## WebMCP explainer

The `/about/webmcp` page becomes a short proof-of-value story rather than a
reference dump.

1. A familiar problem: people repeat job searches and miss changes.
2. One prompt: a compatible browser agent discovers what Jobbbler can do.
3. One visible result: URL, filters, results, and Activity update together.
4. Durable value: an alert continues on the server after the tab closes and
   later reports only the delta.
5. Trust boundary: permission and final application confirmation stay explicit.
6. Broader implication: the pattern applies to other data-rich websites.

Remove the page-by-page 24-tool list. The panel is the live catalog. The page
may show four compact outcome groups, but not every identifier.

## Brand and motion

### Visual signature

- Keep the wordmark in high-contrast ink; do not apply a low-contrast text
  gradient.
- Add a restrained brand mark or accent using the existing green family.
- Use one faint radial green light behind the landing search, at an opacity low
  enough that body text and controls remain visually dominant.
- A subtle gradient may appear on the primary action or active status line, not
  across whole cards or surfaces.
- Avoid heavy glass panels, glow around every control, decorative blobs,
  illustrations, and continuous background animation.

### Motion language

- Landing to results: the hero condenses and the refinement workspace enters as
  one coordinated transition.
- Search/filter change: existing results soften; refreshed rows settle with a
  short stagger.
- Agent call: the relevant surface receives one quiet sweep while the matching
  Activity receipt enters.
- Agent view: panel and main content resize smoothly without a flash or jump.
- Theme: colors transition briefly without animating geometry.
- Hover and press states move no more than one or two pixels.

Durations use the existing fast/base tokens, with an optional 240–320 ms layout
duration for major transitions. Motion uses opacity and transform where
possible. `prefers-reduced-motion: reduce` removes layout movement, stagger,
sweeps, and nonessential fades while preserving immediate state changes.

## Responsive and accessibility requirements

- At 390 px, the header, search, result rows, filters, currency selector, and
  Agent drawer must fit without horizontal scrolling.
- At 200% zoom, primary content remains readable and controls remain reachable.
- Search, location suggestions, filters, tabs, resize control, drawer, theme,
  and every result are operable by keyboard.
- Every custom control has an accessible name, focus indicator, selected state,
  and error/empty behavior.
- Required control boundaries and focus indicators maintain at least 3:1
  non-text contrast; normal text follows WCAG AA.
- Light and dark themes retain the same hierarchy.
- Status updates use one concise live region and do not reannounce complete
  result or activity lists.

## Error and fallback behavior

- The normal portal remains complete when WebMCP is unsupported, preparing, or
  failed.
- Agent view explains the current browser state without presenting it as a
  product failure.
- Location assistance failing leaves the editable text field functional.
- Currency conversion failing or encountering an unsupported currency falls
  back to the original truthful salary rather than hiding the role.
- Search failure retains current criteria and results, with one Retry action.

## Verification

Implementation is complete only when all of the following are proven:

- Component tests cover landing/results switching, navigation labels, location
  combobox keyboard behavior, currency selection/conversion, Agent default tab,
  all-catalog rendering, and reduced Guide content.
- Existing WebMCP registration, manifest, eval, search, saved, comparison, and
  application suites remain green.
- Browser QA verifies landing, filtered results, mobile 390 px, dark theme,
  keyboard-only use, 200% zoom, reduced motion, unsupported WebMCP, and at least
  one real agent activity transition.
- Screenshots at the same viewport compare the previous and final hierarchy;
  visible spacing, wrapping, contrast, focus, and animation artifacts are fixed.
- Focused E2E and `pnpm verify` pass before release integration.

## Non-goals

- Building an embedded chatbot.
- Registering all 29 WebMCP tools at once.
- Adding live foreign-exchange network dependencies to the request path.
- Inventing salary data for third-party listings.
- Adding decorative media, illustrations, persistent background animation, or
  a new visual framework.
- Changing domain authorization, application state-machine, or storage
  semantics except where presentation adapters require truthful currency data.
