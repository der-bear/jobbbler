# Design QA

## Current direction

Jobbbler's public surfaces follow a typography-first, Notion-adjacent system on a neutral
white/near-black palette: one sans face, real form elements, thin dividers, no kickers,
no decorative metrics, and a single restrained green signal accent. The portal reads as a
plain job site; the agentic layer lives in a dedicated, resizable Agent activity panel
docked to the right (open by default, closable, restored by a floating pill).

## Visual evidence (current build)

- Landing registry, no criteria: `docs/design/qa-portal-home.png`
- Filtered search with chips, multi-selects, and salary slider: `docs/design/qa-portal-filtered.png`
- Dark theme: `docs/design/qa-portal-dark.png`
- Role page as an article (meta line: work model · location · employment · seniority · salary): `docs/design/qa-role-article.png`
- Saved searches with plain-language private-space card: `docs/design/qa-saved.png`

Historical captures from earlier iterations remain under `docs/design/` for provenance
(`qa-task*.png`, `audit-mainstream/*`); they do not represent the current interface.

## Verified behavior (current build)

- Landing shows every open role sorted by newest; searching or filtering switches the
  heading to a match count. Filters commit instantly (chips, multi-select dropdowns with
  type-to-filter, salary slider); text fields commit on Enter or blur.
- Every result row is fully clickable with a hover state and opens the role article; the
  registry carries title, company, work model · location, salary, and freshness only.
- The Agent activity panel lists the exact WebMCP tools registered for the current page
  (name, read-only tag, purpose), the live activity log, and a plain-language status; it
  resizes by dragging its edge and collapses to a floating pill.
- The full journey — search → role → saved alert (verified email, encrypted at rest) →
  reviewed application with agent-mediated consent — was re-exercised after the redesign
  through the unit, route, and Playwright suites (`pnpm verify`, `pnpm test:e2e`, 8/8).
- Light and dark themes render from the same token set; reduced-motion leaves no running
  decorative animations (covered by an automated Playwright check).
- Mobile (390px) stacks search and filters above the registry with no horizontal
  overflow (automated Playwright check).
