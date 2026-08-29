# Search and Agent Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Jobbbler into an award-ready, mainstream-simple job portal with a polished landing/search transition and a clear judge-facing Agent view.

**Architecture:** Keep the existing Next.js App Router and CSS Modules. Split presentation-only search controls into focused components and keep URL/API state in `SearchWorkspace`; keep six stable WebMCP entry tools globally registered while the Agent view renders the full static catalog plus live availability. Use existing design tokens, Phosphor icons, and deterministic salary conversion rather than adding dependencies.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules, Vitest, `@jobbbler/contracts`, `@jobbbler/jobs-domain`, `@phosphor-icons/react`.

**Spec:** `docs/superpowers/specs/2026-08-29-search-agent-experience-design.md`

## Global Constraints

- All product copy and documentation remain in English.
- The human-facing portal must stay understandable without WebMCP knowledge.
- The Agent view is secondary, judge-facing, and defaults to Activity.
- Six stable outcome-level WebMCP tools remain available on every route; contextual/state-gated tools remain contextual.
- The full 26-tool catalog is visible in Agent view without registering all 26 tools at once.
- No new runtime dependency, embedded chat, continuous decorative animation, or invented external salary data.
- Light, dark, mobile, keyboard, reduced-motion, and unsupported-browser states must remain usable.

---

### Task 1: Search presentation helpers and controls

**Files:**
- Create: `apps/web/src/features/search/location-combobox.tsx`
- Create: `apps/web/src/features/search/location-combobox.module.css`
- Create: `apps/web/src/features/search/currency-selector.tsx`
- Create: `apps/web/src/features/search/currency-selector.module.css`
- Create: `apps/web/src/features/search/search-presentation.test.ts`
- Modify: `apps/web/src/lib/job-format.ts`

**Interfaces:**
- Produces: `LocationCombobox({ value, onChange, onCommit, options })`; `CurrencySelector({ value, onChange })`; `salaryLabel(salary, displayCurrency?)` where `displayCurrency` is one of EUR, USD, GBP, CAD.
- Consumes: `convertSalaryAmount(amount, fromCurrency, toCurrency)` and existing `SalaryRange`.

- [ ] **Step 1: Write failing presentation tests**

```ts
expect(locationSuggestions(["Kyiv", "Remote", "Europe"], "eu")).toEqual(["Europe"]);
expect(salaryLabel(salary, "EUR")).toMatch(/^≈/);
expect(salaryLabel(null, "EUR")).toBe("Salary not listed");
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm vitest run apps/web/src/features/search/search-presentation.test.ts`

Expected: FAIL because the new helpers and display-currency formatting do not exist.

- [ ] **Step 3: Implement accessible controls and formatting**

```ts
export function locationSuggestions(options: readonly string[], query: string): readonly string[];
export function salaryLabel(salary: SalaryRange | null, displayCurrency = salary?.currency): string;
```

The combobox uses an editable input, `role="combobox"`, `aria-expanded`, a listbox, arrow-key navigation, Enter selection, Escape dismissal, Remote/Global/Europe shortcuts, catalog-derived options, and arbitrary text. The currency selector is a four-option segmented `radiogroup` with 44px targets.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm vitest run apps/web/src/features/search/search-presentation.test.ts && pnpm --filter @jobbbler/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the focused unit**

```bash
git add apps/web/src/features/search/location-combobox.tsx apps/web/src/features/search/location-combobox.module.css apps/web/src/features/search/currency-selector.tsx apps/web/src/features/search/currency-selector.module.css apps/web/src/features/search/search-presentation.test.ts apps/web/src/lib/job-format.ts
git commit -m "feat: add accessible search presentation controls"
```

### Task 2: Landing and results-state search experience

**Files:**
- Modify: `apps/web/src/features/search/search-workspace.tsx`
- Modify: `apps/web/src/features/search/search-workspace.module.css`
- Create: `apps/web/src/features/search/search-workspace.test.tsx`

**Interfaces:**
- Consumes: Task 1 controls and `salaryLabel(job.salary, draft.currency)`.
- Produces: two explicit UI states derived from `landing = no query and no meaningful filter`; a landing state with up to six newest roles and a results state with compact search, filters, currency, and the complete result set.

- [ ] **Step 1: Write failing markup/state tests**

```ts
expect(renderSearchState({ landing: true })).toContain("Latest technology roles");
expect(renderSearchState({ landing: true })).not.toContain('aria-label="Job search filters"');
expect(renderSearchState({ landing: false })).toContain('aria-label="Job search filters"');
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm vitest run apps/web/src/features/search/search-workspace.test.tsx`

Expected: FAIL because the state renderer and split layout do not exist.

- [ ] **Step 3: Implement the state split and hierarchy**

```tsx
{landing ? <LandingSearch latestJobs={result?.jobs.slice(0, 6) ?? []} /> : <ResultsSearch />}
```

Landing: one headline, one supporting sentence, large search/location form, six latest roles, and no filter rail. Results: compact search row, left filter rail, active result count, save-alert action, and sort. Each result orders title, company, neutral work-model tag plus location, converted salary, then freshness. Preserve URL history, WebMCP UI commits, retry, empty, loading, and live-region behavior.

- [ ] **Step 4: Add restrained motion and responsive behavior**

Use one-shot hero condensation, short result entrance, and existing agent receipt pulse. Disable transforms/animations under `prefers-reduced-motion`; split query and location into stacked mobile fields with explicit labels.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm vitest run apps/web/src/features/search/search-workspace.test.tsx apps/web/src/lib/search-url.test.ts && pnpm --filter @jobbbler/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the independently testable search flow**

```bash
git add apps/web/src/features/search/search-workspace.tsx apps/web/src/features/search/search-workspace.module.css apps/web/src/features/search/search-workspace.test.tsx
git commit -m "feat: refine landing and job search experience"
```

### Task 3: Header, branding, and Agent view entry

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/app-shell.module.css`
- Create: `apps/web/src/components/app-shell.test.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Produces: primary navigation labels `Jobs` and `Alerts`; one `Agent view` toggle containing status dot and accessible status label; `data-agent-open` continues to drive content/panel layout.
- Consumes: existing `useWebMcp`, `ThemeToggle`, and AgentPanel.

- [ ] **Step 1: Write a failing shell test**

```ts
expect(markup).toContain("Jobs");
expect(markup).toContain("Alerts");
expect(markup).toContain("Agent view");
expect(markup).not.toContain("Find once. Stay updated.");
expect(markup).not.toContain("Works with agents");
```

- [ ] **Step 2: Run the shell test and confirm failure**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx`

Expected: FAIL on the old labels and duplicate agent entry points.

- [ ] **Step 3: Implement the simplified header and restrained brand layer**

Keep the wordmark text-only, add a subtle gradient treatment to the wordmark/status/primary action, and add one faint non-interactive radial light behind the landing content. Remove the long tagline, `Works with agents`, and floating `Agent layer` trigger. The header toggle must open/close Agent view, expose `aria-expanded`, and retain mobile focus return.

- [ ] **Step 4: Run shell tests and typecheck**

Run: `pnpm vitest run apps/web/src/components/app-shell.test.tsx && pnpm --filter @jobbbler/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/app-shell.tsx apps/web/src/components/app-shell.module.css apps/web/src/components/app-shell.test.tsx apps/web/src/app/globals.css
git commit -m "feat: simplify navigation and agent view entry"
```

### Task 4: Agent view information architecture

**Files:**
- Modify: `apps/web/src/components/agent-panel.tsx`
- Modify: `apps/web/src/components/agent-panel.module.css`
- Modify: `apps/web/src/components/agent-panel.test.tsx`
- Modify: `apps/web/src/components/agent-activity-rail.tsx`
- Modify: `apps/web/src/components/agent-activity-rail.module.css`
- Modify: `apps/web/src/components/agent-activity-rail.test.tsx`
- Modify: `apps/web/src/components/agent-guide.tsx`
- Modify: `apps/web/src/components/agent-guide.module.css`
- Modify: `apps/web/src/components/agent-guide.test.tsx`

**Interfaces:**
- Produces: tab order `Activity`, `Tools`, `Guide`; Activity default; all 29 catalog tools rendered in grouped sections with live active state; concise guide; copyable example prompt.
- Consumes: `webMcpCatalog`, `stableWebMcpCoreNames`, live `RegisteredToolSummary[]`, and `ToolActivity[]`.

- [ ] **Step 1: Update tests to express the approved hierarchy**

```ts
expect(markup).toContain('id="agent-tab-activity"');
expect(markup).toContain('aria-selected="true"');
expect(markup).toContain("Waiting for an agent");
expect(toolsMarkup).toContain("26 tools");
expect(toolsMarkup).not.toContain("View all 26 tools");
```

- [ ] **Step 2: Run panel tests and confirm failure**

Run: `pnpm vitest run apps/web/src/components/agent-panel.test.tsx apps/web/src/components/agent-guide.test.tsx apps/web/src/components/agent-activity-rail.test.tsx`

Expected: FAIL on guide-first selection, old empty copy, and the external all-tools link.

- [ ] **Step 3: Implement Activity-first behavior and useful empty state**

Use `Activity` as the first roving tab and mobile initial focus. Empty state copy: `Waiting for an agent`; explain that tool calls appear as safe receipts; include the copyable prompt from the approved spec. New activity keeps switching to Activity only until the user explicitly selects another tab.

- [ ] **Step 4: Implement the complete, uncluttered catalog**

Render active tools first, then grouped catalog sections. Each row shows friendly purpose, technical name in secondary mono text, `Available now` only when live, and `Approval` only for consequential actions. Remove the `/about/webmcp` view-all link and repeated explanatory paragraphs.

- [ ] **Step 5: Reduce Guide to three facts**

Show only: no setup, one prompt, and the person stays in control. Preserve the detailed explanatory page link once.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm vitest run apps/web/src/components/agent-panel.test.tsx apps/web/src/components/agent-guide.test.tsx apps/web/src/components/agent-activity-rail.test.tsx && pnpm --filter @jobbbler/web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/agent-panel.tsx apps/web/src/components/agent-panel.module.css apps/web/src/components/agent-panel.test.tsx apps/web/src/components/agent-activity-rail.tsx apps/web/src/components/agent-activity-rail.module.css apps/web/src/components/agent-activity-rail.test.tsx apps/web/src/components/agent-guide.tsx apps/web/src/components/agent-guide.module.css apps/web/src/components/agent-guide.test.tsx
git commit -m "feat: make agent view activity-first and judge-ready"
```

### Task 5: WebMCP proof story and release verification

**Files:**
- Modify: `apps/web/src/app/about/webmcp/page.tsx`
- Modify: `apps/web/src/app/about/webmcp/page.module.css`
- Modify: `apps/web/src/app/about/webmcp/page.test.tsx`
- Modify: `docs/submission/README.md`
- Modify: `docs/submission/checklist.md`

**Interfaces:**
- Produces: a concise proof-of-value narrative with outcome, mechanism, proof, and boundaries; no page-by-page 29-tool dump.
- Consumes: the implemented UI, existing WebMCP registration tests, and release verification commands.

- [ ] **Step 1: Update the explanation test**

```ts
expect(markup).toContain("Ask for an outcome");
expect(markup).toContain("No separate MCP server");
expect(markup).toContain("The person stays in control");
expect(markup).not.toContain("Every tool, page by page");
```

- [ ] **Step 2: Run the page test and confirm failure**

Run: `pnpm vitest run apps/web/src/app/about/webmcp/page.test.tsx`

Expected: FAIL on the old reference-heavy page.

- [ ] **Step 3: Implement the concise proof story**

Use four scan-friendly sections: ask for an outcome; the site exposes structured actions; the visible page and Agent view show proof; consent and submission stay explicitly controlled. Retain durable alert behavior and the data-rich-platform extension in plain language.

- [ ] **Step 4: Run full automated verification**

Run: `pnpm verify`

Expected: lint, formatting, typecheck, unit/integration tests, WebMCP manifest validation, and production build all PASS.

- [ ] **Step 5: Verify in the in-app browser**

Inspect landing, filtered results, saved alerts, job detail, application consent, compare, and about pages at desktop and mobile widths in light and dark themes. Verify keyboard-only search/location, Agent view tab order/focus trap, reduced motion, WebMCP stable tools on every route, contextual tool changes, and activity receipts.

- [ ] **Step 6: Update release evidence and commit**

Record verified behavior and remaining deployment-only checks; recapture final gallery media only after the UI is stable.

```bash
git add apps/web/src/app/about/webmcp/page.tsx apps/web/src/app/about/webmcp/page.module.css apps/web/src/app/about/webmcp/page.test.tsx docs/submission/README.md docs/submission/checklist.md
git commit -m "docs: align the WebMCP proof story with the final experience"
```

## Self-Review

- Spec coverage: landing/results split, location help, currency display, header simplification, Agent view hierarchy/catalog, proof page, restrained brand motion, accessibility, fallbacks, and verification each have an implementation task.
- Placeholder scan: no TBD/TODO/fill-later steps remain.
- Type consistency: display currency is carried as a string limited by the selector; existing search URL and contract parsing remain authoritative; Agent view displays but does not globally register the full catalog.
