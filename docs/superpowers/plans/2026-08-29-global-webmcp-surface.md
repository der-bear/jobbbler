# Global WebMCP Surface Implementation Record

> This is the completed implementation record for the global WebMCP surface.
> It retains the original scope, constraints, and verification intent; current
> release evidence appears in Task 4.

**Goal:** Make every Jobbbler workflow discoverable and reachable from every
page through one stable 24-tool WebMCP surface while preserving owner-, state-,
and permission-gated execution.

**Architecture:** Register all 24 focused tools on every document, deduplicate
them by name, and expose a compact catalog grouped by outcome. Keep sensitive
application executors state-gated and make the Agent panel explain global
discovery without implying global authority.

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

### Task 1: Site-wide capability tools — completed

**Files:**

- Create: `apps/web/src/features/site-wide-webmcp-tools.ts`
- Create: `apps/web/src/features/site-wide-webmcp-tools.test.ts`
- Modify: `apps/web/src/lib/webmcp-catalog.ts`
- Modify: `apps/web/src/lib/webmcp-catalog.test.ts`

**Interfaces:**

- Consumes: `webMcpCatalog`, `completedWebMcpResult`, `safeWebMcpErrorResult`, `ToolManifest`.
- Produces: `createSiteWideToolManifests(dependencies)` with
  `open_jobbbler_page` and `prepare_application`.

- [x] **Step 1: Write failing tests**

```ts
expect(names(createSiteWideToolManifests(dependencies))).toEqual([
  "open_jobbbler_page",
  "prepare_application",
]);
expect(await execute("open_jobbbler_page", { page: "saved" })).toMatchObject({
  status: "completed",
});
expect(navigate).toHaveBeenCalledWith("/saved");
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run apps/web/src/features/site-wide-webmcp-tools.test.ts`

Expected: FAIL because the factory does not exist.

- [x] **Step 3: Implement the two manifests and compact capability result**

Validate `page`, `jobIds`, and `draftId` with Zod; build canonical routes; return actionable errors for missing identifiers; keep the result under the shared byte cap.

- [x] **Step 4: Update the catalog and run focused tests**

Run: `pnpm vitest run apps/web/src/features/site-wide-webmcp-tools.test.ts apps/web/src/lib/webmcp-catalog.test.ts`

Expected: PASS.

- [x] **Step 5: Record the implementation**

```bash
The implementation is present in the shared worktree; this documentation pass
does not create a commit.
```

### Task 2: Stable core registration — completed

**Files:**

- Create: `apps/web/src/components/webmcp-registration.ts`
- Create: `apps/web/src/components/webmcp-registration.test.ts`
- Modify: `apps/web/src/components/webmcp-provider.tsx`
- Modify: `apps/web/src/features/webmcp-manifest-validation.test.ts`
- Modify: `tests/e2e/agent-journey.spec.ts`

**Interfaces:**

- Consumes: search manifests, site-wide manifests, workflow planner, route manifests.
- Produces: `composeStableWebMcpManifests(...)` and a provider registration set
  with all 24 focused names.

- [x] **Step 1: Write failing merge and E2E expectations**

```ts
expect(mergeToolManifests(core, contextual).map(({ name }) => name)).toEqual([
  ...coreNames,
  ...contextOnlyNames,
]);
await page.goto("/about/webmcp");
expect(await registeredToolNames(page)).toEqual(expect.arrayContaining(coreNames));
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run apps/web/src/components/webmcp-registration.test.ts apps/web/src/features/webmcp-manifest-validation.test.ts`

Expected: FAIL because registration is still route-only.

- [x] **Step 3: Implement stable core assembly and deduplication**

Create search dependencies once, select the global public manifests by name, add the two site-wide manifests and planner, then merge current route manifests without duplicates. Register the core even when `resolveWebMcpRoute()` returns `none`.

- [x] **Step 4: Verify unit and live agent journey tests**

Run: `pnpm vitest run apps/web/src/components/webmcp-registration.test.ts apps/web/src/features/webmcp-manifest-validation.test.ts && pnpm playwright test tests/e2e/agent-journey.spec.ts`

Expected: PASS; a search invoked on `/about/webmcp` opens `/` and updates visible results.

- [x] **Step 5: Record the implementation**

```bash
The six entry tools are `plan_job_workflow`, `get_search_filters`,
`search_jobs`, `open_job_details`, `prepare_application`, and
`open_jobbbler_page`. All feature manifests remain registered without
duplicate names; state-gated tools return actionable errors when premature.
```

### Task 3: Agent layer hierarchy, accessibility, and restrained state polish — completed

**Files:**

- Modify: `apps/web/src/components/agent-activity-rail.tsx`
- Modify: `apps/web/src/components/agent-activity-rail.module.css`
- Modify: `apps/web/src/components/agent-guide.tsx`
- Modify: `apps/web/src/components/agent-guide.module.css`
- Modify: `apps/web/src/components/agent-activity-rail.test.tsx`
- Modify: `tests/e2e/public-search.spec.ts`

**Interfaces:**

- Consumes: `registeredTools`, `webMcpCatalog`, activity receipts.
- Produces: visible core/context/catalog counts, clear tab structure,
  keyboard-accessible panel, and restrained reduced-motion-safe state feedback.

- [x] **Step 1: Write failing semantic and responsive assertions**

```tsx
expect(markup).toContain("Always available");
expect(markup).toContain("Available in this context");
expect(markup).toContain("capabilities across Jobbbler");
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run apps/web/src/components/agent-activity-rail.test.tsx`

Expected: FAIL because the panel reports only a single route count.

- [x] **Step 3: Implement the hierarchy and accessibility pass**

Use one heading hierarchy, concise rows, visible focus, 44 px interactive targets, polite status regions, clear read/write labels, and no nested card grid. Preserve resize and mobile drawer behavior.

- [x] **Step 4: Verify component, desktop, mobile, keyboard, and reduced-motion behavior**

Run: `pnpm vitest run apps/web/src/components/agent-activity-rail.test.tsx && pnpm playwright test tests/e2e/public-search.spec.ts`

Expected: PASS with no horizontal overflow or hidden focus targets.

- [x] **Step 5: Record the implementation**

```bash
The global Agent layer is available on every page. Its public hierarchy is
Activity, Tools, Guide; Tools exposes all 24 focused tools grouped by outcome.
```

### Task 4: Release verification and documentation alignment — completed

**Files:**

- Modify: `docs/architecture/webmcp-capability-matrix.md`
- Modify: `docs/design/product-experience.md`
- Modify: `docs/submission/demo-storyboard.md`
- Modify: `docs/submission/devpost-copy.md`

**Interfaces:**

- Consumes: verified tool inventory and panel behavior.
- Produces: truthful release claims and current demo/media instructions.

- [x] **Step 1: Update claims from route-only to stable-core plus contextual tools**

Document exact counts only after manifest validation and E2E pass.

- [x] **Step 2: Run the full release suite**

Run: `pnpm verify && pnpm test:e2e`

Current recorded evidence: `pnpm verify` passed with 104 files passed and 1
skipped, 476 tests passed and 29 skipped, and both production builds passed.
The local PostgreSQL 16 contract run passed 35/35.

- [x] **Step 3: Define production smoke and current-media capture**

Use `pnpm smoke:production -- <production-url>` after deployment; recapture the Search, Agent Activity, delta, permission, and mobile states from the submitted build.

- [x] **Step 4: Reconcile verified documentation without overwriting unrelated handoff edits**

```bash
This documentation-only reconciliation does not create a commit.
```
