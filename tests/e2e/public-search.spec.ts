import { expect, test, type Page } from "@playwright/test";

import { collectPageErrors } from "./page-errors";

const exampleOutcome = "senior full-stack engineer";
const seededSearch =
  "/jobs?q=senior+full-stack+engineer&category=software_engineering&work=remote&seniority=senior&location=Europe&salary_min=100000&currency=EUR&exclude=agency";

const seededRole = {
  company: "Jobbbler Demo Systems",
  title: "Senior Full-Stack Engineer",
} as const;
const missingJobId = "job_750e8400-e29b-41d4-a716-446655440000";

function resultCard(page: Page, title: string, company: string) {
  return page.getByRole("article", { name: `${title} at ${company}` });
}

async function firstJobIds(page: Page, count = 2): Promise<readonly string[]> {
  const response = await page.request.get(`/api/v1/jobs/search?limit=${String(count)}`);
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as {
    readonly data: { readonly jobs: readonly { readonly id: string }[] };
  };
  return payload.data.jobs.slice(0, count).map(({ id }) => id);
}

const pageErrors = new WeakMap<Page, () => readonly string[]>();

test.beforeEach(async ({ page }, testInfo) => {
  const expectsComparisonFailure = testInfo.title.includes("when comparison loading fails");
  pageErrors.set(
    page,
    collectPageErrors(page, {
      expectedHttpErrors: [
        // Signed-out visitors have no private activity stream; the panel then
        // renders its intentional browser-mode empty state.
        { method: "GET", pathname: "/api/v1/owners/activity", status: 401 },
        { method: "GET", pathname: `/api/v1/jobs/${missingJobId}`, status: 404 },
        ...(expectsComparisonFailure
          ? [{ method: "GET" as const, pathname: "/api/v1/jobs/compare", status: 502 }]
          : []),
      ],
      expectedRequestFailures: [
        {
          errorText: "net::ERR_ABORTED",
          method: "GET",
          pathname: `/api/v1/jobs/${missingJobId}`,
        },
      ],
    }),
  );
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)?.() ?? [], "Browser errors").toEqual([]);
});

test.describe("public job search workspace", () => {
  test("server-renders the Home preview without a browser search", async ({ page }) => {
    const browserSearchRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/v1/jobs/search") {
        browserSearchRequests.push(request.url());
      }
    });

    await page.goto("/");

    await expect(resultCard(page, seededRole.title, seededRole.company)).toBeVisible();
    expect(browserSearchRequests).toEqual([]);
  });

  test("hydrates the first result without repeating the search from the browser", async ({
    page,
  }) => {
    const browserSearchRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/v1/jobs/search") {
        browserSearchRequests.push(request.url());
      }
    });

    await page.goto(seededSearch);

    await expect(resultCard(page, seededRole.title, seededRole.company)).toBeVisible();
    expect(browserSearchRequests).toEqual([]);
  });

  test("keeps invalid search parameters recoverable without issuing a search", async ({ page }) => {
    const browserSearchRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/v1/jobs/search") {
        browserSearchRequests.push(request.url());
      }
    });

    await page.goto("/jobs?limit=999");

    await expect(
      page.getByRole("region", { name: "Technology roles" }).getByRole("alert"),
    ).toContainText("search filters are invalid");
    await expect(page.getByRole("searchbox", { name: "Search" })).toBeEditable();
    expect(browserSearchRequests).toEqual([]);
  });

  test("shows signed-out users explainable, sourced search results", async ({ page }) => {
    await page.goto(seededSearch);

    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("link", { name: "Jobbbler home" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue(
      "senior full-stack engineer",
    );
    await expect(page.getByRole("status", { name: "Search status" })).toContainText(
      /\bmatch(?:es)?\b/i,
    );

    const role = resultCard(page, seededRole.title, seededRole.company);
    await expect(role).toBeVisible();
    const freshness = role.locator("time");
    await expect(freshness).toHaveText(/(?:just now|\d+[hd] ago)/i);
    await expect(freshness).toHaveAttribute("title", /^Updated /);
    await expect(
      role.getByRole("link", {
        name: `View details for ${seededRole.title} at ${seededRole.company}`,
      }),
    ).toBeVisible();
  });

  test("submits an outcome with Enter and writes shareable URL state", async ({ page }) => {
    await page.goto("/");

    const outcome = page.getByRole("searchbox", { name: "Search jobs" });
    await outcome.fill(exampleOutcome);
    await outcome.press("Enter");

    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(exampleOutcome);
    await expect(page.getByRole("status", { name: "Search status" })).toContainText(
      /\bmatch(?:es)?\b/i,
    );
  });

  test("keeps URL-backed filters editable through the visible controls", async ({ page }) => {
    await page.goto(seededSearch);

    await page.getByRole("button", { name: "Remote", pressed: true }).click();

    await expect(page).not.toHaveURL(/(?:\?|&)work=remote(?:&|$)/);
    await expect(page.getByRole("status", { name: "Search status" })).toContainText(
      /\bmatch(?:es)?\b/i,
    );
  });

  test("resets every active filter in one clear action", async ({ page }) => {
    await page.goto(
      "/jobs?q=platform&location=Berlin%2C+Germany&work=remote&seniority=staff&sort=newest",
    );

    const reset = page.getByRole("button", { name: "Reset filters" });
    await expect(reset).toBeVisible();
    const search = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/jobs/search" && !url.searchParams.has("location");
    });
    await reset.click();
    await search;

    await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Location" })).toHaveValue("");
    await expect(page.getByRole("button", { name: "Remote" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page).not.toHaveURL(/(?:\?|&)(?:q|location|work|seniority)=/u);
    await expect(reset).toHaveCount(0);
  });

  test("opens the judge-facing agent activity panel by default on wide screens", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("complementary", { name: "What your agent is doing" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Agent activity —/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("tab", { name: /^Activity/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("keeps the how-it-works explanation readable beside the default agent panel", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/about/webmcp");

    await expect(
      page.getByRole("complementary", { name: "What your agent is doing" }),
    ).toBeVisible();
    const section = page.getByRole("region", { name: "Built into the site" });
    const accountNote = section.locator("p").filter({ hasText: "No account is needed" });
    await expect(accountNote).toBeVisible();
    const bounds = await accountNote.boundingBox();

    expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(280);
  });

  test("keeps every catalog result reachable without replacing earlier pages", async ({ page }) => {
    await page.goto("/jobs");

    const roles = page.getByRole("article");
    await expect(roles).toHaveCount(20);
    const firstRoleName = await roles.first().getAttribute("aria-label");

    const loadMore = page.getByRole("button", { name: /Load more roles/i });
    await expect(loadMore).toHaveAttribute("aria-controls", "search-results");
    await loadMore.click();

    await expect(roles).toHaveCount(40);
    await expect(roles.first()).toHaveAttribute("aria-label", firstRoleName ?? "");
    await expect(page.getByText(/40 of \d+ matching jobs loaded/i)).toBeAttached();
  });

  test("keeps mobile result rows inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/jobs");

    const roles = page.getByRole("article");
    await expect(roles.first()).toBeVisible();
    const geometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      rows: [...document.querySelectorAll<HTMLElement>("article")].map((row) => {
        const bounds = row.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right };
      }),
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(geometry.scrollWidth).toBe(geometry.clientWidth);
    expect(geometry.rows.length).toBeGreaterThan(0);
    for (const row of geometry.rows) {
      expect(row.left).toBeGreaterThanOrEqual(0);
      expect(row.right).toBeLessThanOrEqual(geometry.clientWidth);
    }
  });

  test("keeps comparison agent-driven without adding controls to ordinary search", async ({
    page,
  }) => {
    await page.goto("/jobs");

    await expect(page.getByRole("button", { name: /^Add .+ to comparison$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove .+ from comparison$/ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Comparison selection" })).toHaveCount(0);

    const jobIds = await firstJobIds(page);
    await page.goto(`/compare?currency=USD&sort=newest&id=${jobIds.join("&id=")}`);
    await expect(page.getByRole("region", { name: "Role comparison", exact: true })).toBeVisible();
    const openRoleHref = await page
      .getByRole("link", { name: /^Open .+ role$/ })
      .first()
      .getAttribute("href");
    expect(openRoleHref).not.toBeNull();
    const openRoleUrl = new URL(openRoleHref ?? "", page.url());
    expect(openRoleUrl.searchParams.get("currency")).toBe("USD");
    expect(openRoleUrl.searchParams.get("sort")).toBe("newest");
  });

  test("keeps three compared roles readable in a keyboard-scrollable snap track", async ({
    page,
  }) => {
    const jobIds = await firstJobIds(page, 3);
    await page.goto(`/compare?id=${jobIds.join("&id=")}`);

    const track = page.getByRole("region", {
      name: "Role comparison table",
      exact: true,
    });
    await expect(track).toBeVisible();
    await expect(track.getByRole("columnheader")).toHaveCount(4);

    const geometry = await track.evaluate((element) => {
      const firstRoleHeader = element.querySelector("thead th:nth-child(2)");
      return {
        clientWidth: element.clientWidth,
        firstRoleSnap:
          firstRoleHeader === null ? "" : getComputedStyle(firstRoleHeader).scrollSnapAlign,
        scrollSnapType: getComputedStyle(element).scrollSnapType,
        scrollWidth: element.scrollWidth,
      };
    });
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
    expect(geometry.scrollSnapType).toContain("mandatory");
    expect(geometry.firstRoleSnap).toBe("start");

    await track.focus();
    await expect(track).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => track.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  });

  test("offers retry, change-selection, and return paths when comparison loading fails", async ({
    page,
  }) => {
    const jobIds = await firstJobIds(page);
    let compareRequests = 0;
    let failComparison = true;
    await page.route("**/api/v1/jobs/compare?**", async (route) => {
      compareRequests += 1;
      if (failComparison) {
        await route.fulfill({
          body: JSON.stringify({
            ok: false,
            error: {
              code: "DEPENDENCY",
              message: "Comparison is temporarily unavailable.",
              retryable: true,
              requestId: "req_550e8400-e29b-41d4-a716-446655440000",
            },
          }),
          contentType: "application/json",
          status: 502,
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`/compare?id=${jobIds.join("&id=")}`);
    await expect(
      page.getByRole("heading", { name: "Comparison is temporarily unavailable." }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Change selection" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to search" })).toBeVisible();

    failComparison = false;
    await page.getByRole("button", { name: "Retry comparison" }).click();
    await expect(page.getByRole("region", { name: "Role comparison", exact: true })).toBeVisible();
    expect(compareRequests).toBe(2);

    const primaryTargets = [
      page.getByRole("link", { name: /^Open .+ role$/ }).first(),
      page.getByRole("link", { name: /^Remove .+ from comparison$/ }).first(),
      page.getByRole("link", { name: "Add another role" }),
      page.getByRole("link", { name: "Return to search" }),
    ];
    for (const target of primaryTargets) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("returns a useful page state and NOT_FOUND contract for a valid missing role", async ({
    page,
  }) => {
    const response = await page.request.get(`/api/v1/jobs/${missingJobId}`);
    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "Job was not found." },
    });

    await page.goto(`/jobs/${missingJobId}`);
    await expect(
      page.getByRole("heading", {
        name: "This role is no longer available in the current catalog.",
      }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to search" })).toBeVisible();
  });

  test("ignores an older next page after the search criteria change", async ({ page }) => {
    let markNextPageStarted: (() => void) | undefined;
    const nextPageStarted = new Promise<void>((resolve) => {
      markNextPageStarted = resolve;
    });
    await page.exposeFunction("markNextPageStarted", () => {
      markNextPageStarted?.();
    });
    await page.addInitScript(() => {
      type DeferredFetchWindow = Window &
        typeof globalThis & {
          markNextPageStarted: () => Promise<void>;
          releaseNextPage: () => void;
        };
      const deferredWindow = window as DeferredFetchWindow;
      const originalFetch = window.fetch.bind(window);
      let releaseNextPage = () => undefined;
      const nextPageReleased = new Promise<void>((resolve) => {
        releaseNextPage = resolve;
      });
      deferredWindow.releaseNextPage = releaseNextPage;
      window.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
          window.location.href,
        );
        if (url.pathname !== "/api/v1/jobs/search" || !url.searchParams.has("cursor")) {
          return originalFetch(input, init);
        }

        const unabortableInit = { ...init };
        delete unabortableInit.signal;
        const response = await originalFetch(input, unabortableInit);
        await deferredWindow.markNextPageStarted();
        await nextPageReleased;
        return response;
      };
    });

    await page.goto("/jobs");
    await page.getByRole("button", { name: /Load more roles/i }).click();
    await nextPageStarted;

    await expect(page.locator("#search-results")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status", { name: "Search update" })).toHaveText(
      "Updating results…",
    );

    const sortedResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/v1/jobs/search" &&
        url.searchParams.get("sort") === "salary_desc" &&
        !url.searchParams.has("cursor")
      );
    });
    await page.getByRole("combobox", { name: "Sort jobs" }).selectOption("salary_desc");
    await sortedResponse;
    await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("salary_desc");
    await expect(page.getByRole("article")).toHaveCount(20);
    const sortedRoleNames = await page
      .getByRole("article")
      .evaluateAll((roles) => roles.map((role) => role.getAttribute("aria-label")));

    await page.evaluate(() => {
      (window as Window & { releaseNextPage: () => void }).releaseNextPage();
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );

    await expect(page.getByRole("article")).toHaveCount(20);
    expect(
      await page
        .getByRole("article")
        .evaluateAll((roles) => roles.map((role) => role.getAttribute("aria-label"))),
    ).toEqual(sortedRoleNames);
  });

  test("uses one clear focus treatment for the location combobox", async ({ page }) => {
    await page.goto("/jobs?sort=newest");

    const location = page.getByRole("combobox", { name: "Location" });
    await location.focus();

    const outlinedAncestors = await location.evaluate((input) => {
      const elements: HTMLElement[] = [];
      let element: HTMLElement | null = input;
      while (element !== null && elements.length < 6) {
        elements.push(element);
        element = element.parentElement;
      }
      return elements.filter((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
      }).length;
    });

    expect(outlinedAncestors).toBe(1);
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });

  test("opens a detail page that retains ranking evidence and provenance", async ({ page }) => {
    await page.goto(seededSearch);

    await resultCard(page, seededRole.title, seededRole.company)
      .getByRole("link", {
        name: `View details for ${seededRole.title} at ${seededRole.company}`,
      })
      .click();

    await expect(page).toHaveURL(/\/jobs\/[^/?#]+/);
    await expect.poll(() => new URL(page.url()).searchParams.get("salary_min")).toBe("100000");
    await expect(page.getByRole("heading", { name: seededRole.title })).toBeVisible();
    await expect
      .poll(async () => {
        const workspace = page.getByRole("article");
        const box = await workspace.boundingBox();
        return box?.width ?? 0;
      })
      .toBeGreaterThan(700);
    await expect(page.getByRole("region", { name: "How it fits your search" })).toContainText(
      "Work model is remote.",
    );
    await expect(page.getByRole("region", { name: "About this posting" })).toContainText(
      /Jobbbler demo|source/i,
    );
    await expect(page.getByRole("region", { name: "About this posting" })).toContainText(
      "Handled on Jobbbler",
    );
  });

  test("keeps a display-currency choice from search through role details", async ({ page }) => {
    await page.goto("/jobs?sort=newest");
    await page.getByRole("radio", { name: "USD" }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get("currency")).toBe("USD");
    const firstRole = page.getByRole("article").first();
    await expect(firstRole.locator("strong").last()).toContainText("$");
    await firstRole.getByRole("link", { name: /^View details for / }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get("currency")).toBe("USD");
    await expect(page.getByRole("main")).toContainText(/\$[\d,]+k?–\$[\d,]+k? \/ yr/u);
  });

  test("persists the selected theme after a reload", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
  });

  test("keeps pointer-selected agent tabs free of a keyboard-only focus ring", async ({ page }) => {
    await page.goto("/about/webmcp");

    const guideTab = page.getByRole("tab", { name: "Guide" });
    await guideTab.click();

    await expect(guideTab).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => guideTab.evaluate((element) => getComputedStyle(element).outlineStyle))
      .toBe("none");
  });

  test("remains usable when WebMCP is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "modelContext", { configurable: true, value: undefined });
    });
    await page.goto("/");

    await expect(
      page.getByRole("button", { name: /Agent activity — Browser mode/i }),
    ).toBeVisible();
    const outcome = page.getByRole("searchbox", { name: "Search jobs" });
    await outcome.fill(exampleOutcome);
    await outcome.press("Enter");

    await expect(page.getByRole("status", { name: "Search status" })).toContainText(
      /\bmatch(?:es)?\b/i,
    );
    await expect(resultCard(page, seededRole.title, seededRole.company)).toBeVisible();
  });
});

test.describe("mobile and reduced-motion public search", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("keeps the current result visible at 390px without horizontal scrolling", async ({
    page,
  }) => {
    await page.goto(seededSearch);

    await expect(page.getByRole("searchbox", { name: "Search" })).toBeVisible();
    await page.getByRole("button", { name: /More filters/ }).click();
    await expect(page.getByRole("button", { name: "Remote", pressed: true })).toBeVisible();
    await expect(resultCard(page, seededRole.title, seededRole.company)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });

  test("keeps the primary navigation readable at the narrowest supported width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");

    const navigation = page.getByRole("navigation", { name: "Primary navigation" }).filter({
      visible: true,
    });
    await expect(navigation.getByRole("link", { name: "Open roles" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Saved searches" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "My applications" })).toBeVisible();

    for (const label of ["Roles", "Saved", "Applications"] as const) {
      const visibleLabel = navigation.getByText(label, { exact: true });
      await expect(visibleLabel).toBeVisible();
      await expect
        .poll(async () =>
          visibleLabel.evaluate((element) => {
            const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
            return element.getBoundingClientRect().height <= lineHeight * 1.1;
          }),
        )
        .toBe(true);
    }

    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });

  test("stacks comparison facts with role context instead of hiding them in a wide table", async ({
    page,
  }) => {
    const jobIds = await firstJobIds(page);
    await page.goto(`/compare?id=${jobIds.join("&id=")}`);

    const comparison = page.getByRole("region", { name: "Role comparison", exact: true });
    await expect(comparison).toBeVisible();
    await expect(comparison.getByRole("article")).toHaveCount(2);
    await expect(page.getByRole("table")).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });

  test("does not leave decorative animations running for reduced-motion users", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(seededSearch);

    await expect(page.getByRole("status", { name: "Search status" })).toContainText(
      /\bmatch(?:es)?\b/i,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === "running").length,
        ),
      )
      .toBe(0);
  });

  test("keeps the judge-facing agent layer out of the main mobile task until requested", async ({
    page,
  }) => {
    await page.goto("/");

    const trigger = page.getByRole("button", { name: /Agent activity/ });
    await expect(trigger).toBeVisible();
    await expect(page.getByRole("dialog", { name: "What your agent is doing" })).toHaveCount(0);

    await trigger.click();
    const panel = page.getByRole("dialog", { name: "What your agent is doing" });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("tab", { name: "Activity" })).toBeFocused();
    await expect(page.locator("header[inert]")).toHaveCount(1);
    await expect(page.locator("main[inert]")).toHaveCount(1);

    await page.getByRole("tab", { name: "Activity" }).press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
