# Design QA

## Scope

Jobbbler search, comparison, and role-detail surfaces were reviewed against the selected Editorial Workspace reference and exercised in the Codex in-app browser. The review covered desktop and mobile layouts, light and dark themes, keyboard-readable structure, core discovery interactions, and route-scoped WebMCP feedback.

## Visual evidence

- Reference: `docs/design/reference/editorial-workspace.png`
- Normalized reference/implementation comparison: `docs/design/qa-task7-comparison.png`
- Desktop implementation capture: `docs/design/qa-task7-desktop.png`
- Mobile implementation capture at a true 390 × 844 browsing viewport: `docs/design/qa-task7-mobile.jpg`

The combined comparison was inspected at original detail. The implementation preserves the reference's editorial hierarchy, restrained green signal color, evidence-first density, thin dividers, compact controls, and clear primary/secondary reading order while adapting the content to Jobbbler's job-discovery domain.

## Functional and responsive checks

- Search returned three realistic technology-role records with explicit filters, evidence, unknowns, provenance, freshness, and shareable URL state.
- Compare selection exposed the compare action only after jobs were selected and rendered a readable two-role evidence table.
- Role detail preserved provenance and made unavailable application/source states explicit.
- The in-app browser discovered exactly two relevant WebMCP tools on each route and replaced the tool set after Search → Compare → Detail navigation.
- Theme switching updated the document theme and verified dark-mode canvas and text colors.
- The mobile layout was rendered inside a genuine 390 × 844 iframe browsing context so CSS media queries, fixed positioning, and responsive overflow were exercised by the browser.
- Mobile filters and Agent Activity are represented as labeled bottom sheets; controls remain usable without WebMCP support.
- A real mobile P1 defect was found: the header backdrop filter created a containing block that trapped the fixed bottom navigation at the top of the header. Mobile now uses an opaque header without backdrop filtering, restoring the wordmark/theme controls at the top and navigation at the viewport bottom.
- The shared UI barrel is explicitly client-bound, eliminating a React Server Components failure that appeared in Next.js development mode.

## Severity review

- P0 blockers: none.
- P1 usability or structural defects: none remaining.
- P2 visual polish defects: none remaining in the reviewed states.

final result: passed
