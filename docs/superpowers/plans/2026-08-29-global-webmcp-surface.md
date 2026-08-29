# Global WebMCP Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Jobbbler workflow reachable from every page through a stable WebMCP core while preserving context- and permission-gated execution.

**Architecture:** Register six site-wide core tools on every document, merge them with route/state manifests by unique name, and expose a compact capability catalog that distinguishes always-available tools from current context tools. Keep sensitive application executors state-gated and improve the Agent panel so judges can understand the two layers immediately.

**Tech Stack:** TypeScript, React 19, Next.js 16, Zod 4, WebMCP imperative registration, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-global-webmcp-surface-design.md`

## Global Constraints

- Tool names are at most 30 characters and descriptions at most 500 characters.
- Individual serialized tool results are at most 1.5 KB.
- No separate MCP server, embedded chat, reusable agent credential, or generic execute tool.
- Application authorization, data permission, and final confirmation remain distinct server-checked stages.
- The ordinary website remains fully usable without WebMCP.
- All user-facing product and documentation copy is English.
- New motion must be optional under `prefers-reduced-motion`.

---

### Task 1: Site-wide capability tools

**Files:**
- Create: `apps/web/src/features/site-wide-webmcp-tools.ts`
- Create: `apps/web/src/features/site-wide-webmcp-tools.test.ts`
- Modify: `apps/web/src/lib/webmcp-catalog.ts`
- Modify: `apps/web/src/lib/webmcp-catalog.test.ts`

**Interfaces:**
- Consumes: `webMcpCatalog`, `completedWebMcpResult`, `safeWebMcpErrorResult`, `ToolManifest`.
- Produces: `createSiteWideToolManifests(dependencies)` with `get_site_capabilities` and `open_jobbbler_page`.

- [ ] **Step 1: Write failing tests**

```ts
expect(names(createSiteWideToolManifests(dependencies))).toEqual([
  "get_site_capabilities",
  "open_jobbbler_page",
]);
expect(await execute("open_jobbbler_page", { page: "saved" })).toMatchObject({
  status: "completed",
});
expect(navigate).toHaveBeenCalledWith("/saved");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run apps/web/src/features/site-wide-webmcp-tools.test.ts`

Expected: FAIL because the factory does not exist.

- [ ] **Step 3: Implement the two manifests and compact capability result**

Validate `page`, `jobIds`, and `draftId` with Zod; build canonical routes; return actionable errors for missing identifiers; keep the result under the shared byte cap.

- [ ] **Step 4: Update the catalog and run focused tests**

Run: `pnpm vitest run apps/web/src/features/site-wide-webmcp-tools.test.ts apps/web/src/lib/webmcp-catalog.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the task**

```bash
git add apps/web/src/features/site-wide-webmcp-tools.ts apps/web/src/features/site-wide-webmcp-tools.test.ts apps/web/src/lib/webmcp-catalog.ts apps/web/src/lib/webmcp-catalog.test.ts
git commit -m "feat: expose site-wide WebMCP capabilities"
```

### Task 2: Stable core registration

**Files:**
- Create: `apps/web/src/components/webmcp-registration.ts`
- Create: `apps/web/src/components/webmcp-registration.test.ts`
- Modify: `apps/web/src/components/webmcp-provider.tsx`
- Modify: `apps/web/src/features/webmcp-manifest-validation.test.ts`
- Modify: `tests/e2e/agent-journey.spec.ts`

**Interfaces:**
- Consumes: search manifests, site-wide manifests, workflow planner, route manifests.
- Produces: `mergeToolManifests(core, contextual)` and a provider registration set with six stable core names.

- [ ] **Step 1: Write failing merge and E2E expectations**

```ts
expect(mergeToolManifests(core, contextual).map(({ name }) => name)).toEqual([
  ...coreNames,
  ...contextOnlyNames,
]);
await page.goto("/about/webmcp");
expect(await registeredToolNames(page)).toEqual(expect.arrayContaining(coreNames));
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run apps/web/src/components/webmcp-registration.test.ts apps/web/src/features/webmcp-manifest-validation.test.ts`

Expected: FAIL because registration is still route-only.

- [ ] **Step 3: Implement stable core assembly and deduplication**

Create search dependencies once, select the global public manifests by name, add the two site-wide manifests and planner, then merge current route manifests without duplicates. Register the core even when `resolveWebMcpRoute()` returns `none`.

- [ ] **Step 4: Verify unit and live agent journey tests**

Run: `pnpm vitest run apps/web/src/components/webmcp-registration.test.ts apps/web/src/features/webmcp-manifest-validation.test.ts && pnpm playwright test tests/e2e/agent-journey.spec.ts`

Expected: PASS; a search invoked on `/about/webmcp` opens `/` and updates visible results.

- [ ] **Step 5: Commit the task**

```bash
git add apps/web/src/components/webmcp-registration.ts apps/web/src/components/webmcp-registration.test.ts apps/web/src/components/webmcp-provider.tsx apps/web/src/features/webmcp-manifest-validation.test.ts tests/e2e/agent-journey.spec.ts
git commit -m "feat: keep WebMCP workflows reachable across routes"
```

### Task 3: Agent panel hierarchy, accessibility, and restrained signal polish

**Files:**
- Modify: `apps/web/src/components/agent-activity-rail.tsx`
- Modify: `apps/web/src/components/agent-activity-rail.module.css`
- Modify: `apps/web/src/components/agent-guide.tsx`
- Modify: `apps/web/src/components/agent-guide.module.css`
- Modify: `apps/web/src/components/agent-activity-rail.test.tsx`
- Modify: `tests/e2e/public-search.spec.ts`

**Interfaces:**
- Consumes: `registeredTools`, `webMcpCatalog`, activity receipts.
- Produces: visible core/context/catalog counts, clear tab structure, keyboard-accessible panel, and one reduced-motion-safe signal pulse.

- [ ] **Step 1: Write failing semantic and responsive assertions**

```tsx
expect(markup).toContain("Always available");
expect(markup).toContain("Available in this context");
expect(markup).toContain("capabilities across Jobbbler");
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run apps/web/src/components/agent-activity-rail.test.tsx`

Expected: FAIL because the panel reports only a single route count.

- [ ] **Step 3: Implement the hierarchy and accessibility pass**

Use one heading hierarchy, concise rows, visible focus, 44 px interactive targets, polite status regions, clear read/write labels, and no nested card grid. Preserve resize and mobile drawer behavior.

- [ ] **Step 4: Verify component, desktop, mobile, keyboard, and reduced-motion behavior**

Run: `pnpm vitest run apps/web/src/components/agent-activity-rail.test.tsx && pnpm playwright test tests/e2e/public-search.spec.ts`

Expected: PASS with no horizontal overflow or hidden focus targets.

- [ ] **Step 5: Commit the task**

```bash
git add apps/web/src/components/agent-activity-rail.tsx apps/web/src/components/agent-activity-rail.module.css apps/web/src/components/agent-guide.tsx apps/web/src/components/agent-guide.module.css apps/web/src/components/agent-activity-rail.test.tsx tests/e2e/public-search.spec.ts
git commit -m "style: clarify the global agent capability panel"
```

### Task 4: Release verification and documentation alignment

**Files:**
- Modify: `docs/architecture/webmcp-capability-matrix.md`
- Modify: `docs/design/product-experience.md`
- Modify: `docs/submission/demo-storyboard.md`
- Modify: `docs/submission/devpost-copy.md`

**Interfaces:**
- Consumes: verified tool inventory and panel behavior.
- Produces: truthful release claims and current demo/media instructions.

- [ ] **Step 1: Update claims from route-only to stable-core plus contextual tools**

Document exact counts only after manifest validation and E2E pass.

- [ ] **Step 2: Run the full release suite**

Run: `pnpm verify && pnpm test:e2e`

Expected: formatting, lint, typecheck, unit tests, production build, and all E2E specs pass with pristine output.

- [ ] **Step 3: Run production smoke and capture current media**

Use `pnpm smoke:production -- <production-url>` after deployment; recapture the Search, Agent Activity, delta, permission, and mobile states from the submitted build.

- [ ] **Step 4: Commit verified documentation without overwriting unrelated handoff edits**

```bash
git add docs/architecture/webmcp-capability-matrix.md docs/design/product-experience.md docs/submission/demo-storyboard.md docs/submission/devpost-copy.md
git commit -m "docs: document the global WebMCP surface"
```
