# Design and Accessibility QA

This document is the release contract for Jobbbler's public interface. It
describes the states that must be checked on the final submitted revision; it
does not treat screenshots from an earlier build as evidence.

## Experience contract

- The public product reads as a familiar technology-jobs portal. Search,
  filters, role details, saved searches, inspectable agent-assisted comparison
  results, and application state do not require knowledge of WebMCP.
- Typography, spacing, thin rules, and restrained semantic color create the
  hierarchy. Decorative effects do not compete with the current task.
- Compact product text uses the shared caption, label, UI, small-body, and body
  roles; responsive display sizes are reserved for real headings. Pills use
  the shared pill-radius token so control geometry does not drift by route.
- Home is the simple starting state. Jobs is the focused search workspace.
  Search and location controls help people enter valid criteria without
  requiring them to understand the underlying data model.
- Role pages read like documents: title, organization, work model, location,
  salary, source, freshness, evidence, and the next available action appear in
  a predictable order.
- The global Agent activity panel is a judge- and developer-facing transparency surface,
  not a second product. Activity is the default tab, followed by Tools and
  Guide. All 29 tools remain registered across navigation; execution still
  enforces ownership and workflow state.
- Empty, loading, unavailable, cancelled, user-action, and error states explain
  what happened and what can happen next without exposing private values or
  reusable identifiers.
- Light and dark themes preserve the same reading order and semantic emphasis.
  Reduced-motion mode removes non-essential animation.
- At mobile widths the primary human task stays first. Agent activity opens only
  when requested and does not create horizontal page overflow.

The detailed product and visual rationale is in
[Product Experience](product-experience.md).

## Final evidence plan

Run these checks against the exact revision that will be deployed, recorded,
and submitted:

1. Inspect Home, Jobs, role detail, an agent-assisted comparison result, Saved,
   Applications, one application review, and About WebMCP at desktop and mobile
   widths.
2. Verify light and dark themes, browser zoom, long labels, empty datasets,
   invalid URL criteria, unavailable WebMCP, and network or command errors.
3. Traverse every primary control with the keyboard. Confirm visible focus,
   logical focus order, correct accessible names, and focus containment and
   return for the mobile Agent activity panel.
4. Check text and interactive-control contrast against the final computed
   colors. Do not treat a screenshot alone as contrast evidence.
5. Confirm filters and navigation respond without duplicate visible work,
   stale state, layout shift, or horizontal overflow. Record cold and warm
   behavior separately when assessing performance.
6. Invoke representative WebMCP search, navigation, alert, and application
   tools. Confirm URL, visible state, Agent Activity, and the authoritative
   result agree while all 29 tools remain discoverable.
7. Verify the ordinary interface remains usable when WebMCP is absent or tool
   registration fails.
8. Re-run the deterministic verification, focused browser suite, PostgreSQL
   contract, migration rehearsal, and production smoke checks after the final
   UI commit.

## Visual evidence

Capture submission media only after the interface and deployed revision are
frozen. Use the same real product states in the gallery and video, keep private
values out of frame, and verify every image at its final crop and upload size.
Production scripts, form drafts, and gallery working files stay outside this
public repository.
