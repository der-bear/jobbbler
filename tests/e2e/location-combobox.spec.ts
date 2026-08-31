import { expect, test, type Page, type Route } from "@playwright/test";

import { collectPageErrors } from "./page-errors";

const pageErrors = new WeakMap<Page, () => readonly string[]>();

test.beforeEach(async ({ page }) => {
  pageErrors.set(
    page,
    collectPageErrors(page, {
      expectedHttpErrors: [
        { method: "GET", pathname: "/api/v1/owners/activity", status: 401 },
        { method: "GET", pathname: "/api/v1/jobs/locations", status: 503 },
      ],
    }),
  );
});

test.afterEach(async ({ page }) => {
  const errors = (pageErrors.get(page)?.() ?? []).filter(
    (error) =>
      !error.includes("/api/v1/jobs/locations?q=Ber&limit=8: net::ERR_ABORTED") &&
      !(
        error.startsWith("requestfailed: GET ") &&
        error.includes("/jobs?") &&
        error.includes("_rsc=") &&
        error.endsWith("net::ERR_ABORTED")
      ),
  );
  expect(errors, "Browser errors").toEqual([]);
});

async function fulfillLocations(route: Route, locations: readonly string[], delay = 0) {
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  await route.fulfill({
    contentType: "application/json",
    status: 200,
    body: JSON.stringify({ ok: true, data: { locations } }),
  });
}

async function outlinedElementCount(page: Page, label: string) {
  return page.getByRole("combobox", { name: label }).evaluate((input) => {
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
}

async function compositeFocusPresentation(page: Page, label: string) {
  return page.getByRole("combobox", { name: label }).evaluate((input) => {
    let owner: HTMLElement | null = input;
    while (owner !== null) {
      const candidateStyle = getComputedStyle(owner);
      if (
        candidateStyle.outlineStyle !== "none" &&
        Number.parseFloat(candidateStyle.outlineWidth) > 0
      ) {
        break;
      }
      owner = owner.parentElement;
    }
    if (owner === null) return null;
    const style = getComputedStyle(owner);
    return {
      borderColor: style.borderColor,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      outlineWidth: style.outlineWidth,
    };
  });
}

function waitForLocationSearch(page: Page, location: string | null) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/jobs/search" &&
      url.searchParams.get("location") === location &&
      response.status() === 200
    );
  });
}

test.describe("location combobox", () => {
  test.describe.configure({ timeout: 60_000 });

  test("exposes direct listbox options and supports the complete keyboard contract", async ({
    page,
  }) => {
    await page.route("**/api/v1/jobs/locations?**", async (route) => {
      await fulfillLocations(route, ["Phoenix, AZ", "Phoenixville, PA"]);
    });
    await page.goto("/");

    const input = page.getByRole("combobox", { name: "Location" });
    await input.fill("Pho");

    const listbox = page.getByRole("listbox");
    const options = listbox.locator(":scope > [role=option]");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveText("Phoenix, AZ");
    await expect(options.nth(2)).toContainText("Search for \u201cPho\u201d");
    await expect(input).toHaveAttribute("aria-controls", await listbox.getAttribute("id"));

    await input.press("End");
    await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
    await input.press("Home");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
    await input.press("ArrowUp");
    await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
    await input.press("ArrowDown");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
    await input.press("Enter");
    await expect(input).toHaveValue("Phoenix, AZ");
    await expect(listbox).toBeHidden();

    await input.fill("Pho");
    await input.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(input).not.toHaveAttribute("aria-controls");
  });

  test("debounces, aborts stale requests, reuses cached results, and reports loading", async ({
    page,
  }) => {
    const queries: string[] = [];
    await page.route("**/api/v1/jobs/locations?**", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q") ?? "";
      queries.push(query);
      if (query === "Ber") {
        await fulfillLocations(route, ["Berlin, Germany"], 650);
      } else {
        await fulfillLocations(route, ["Phoenix, AZ"], 250);
      }
    });
    await page.goto("/");
    const input = page.getByRole("combobox", { name: "Location" });

    await input.pressSequentially("Pho", { delay: 35 });
    await expect(page.getByText("Looking up locations\u2026")).toBeVisible();
    await expect(page.getByRole("option", { name: "Phoenix, AZ" })).toBeVisible();
    expect(queries).toEqual(["Pho"]);

    await input.fill("");
    await input.fill("Pho");
    await expect(page.getByRole("option", { name: "Phoenix, AZ" })).toBeVisible();
    await page.waitForTimeout(250);
    expect(queries).toEqual(["Pho"]);

    await input.fill("Ber");
    await expect.poll(() => queries).toContain("Ber");
    await input.fill("Phoenix");
    await expect(page.getByRole("option", { name: "Phoenix, AZ" })).toBeVisible();
    await page.waitForTimeout(700);
    await expect(page.getByRole("option", { name: "Berlin, Germany" })).toHaveCount(0);
  });

  test("keeps free text usable across empty, mouse selection, and clear states", async ({
    page,
  }) => {
    await page.route("**/api/v1/jobs/locations?**", async (route) => {
      await fulfillLocations(route, []);
    });
    await page.goto("/jobs?sort=newest");
    const input = page.getByRole("combobox", { name: "Location" });

    await input.fill("Atlantis");
    await expect(
      page.getByText("No listed location matches yet. You can still search this place."),
    ).toBeVisible();
    const atlantisSearch = waitForLocationSearch(page, "Atlantis");
    await page.getByRole("option", { name: "Search for \u201cAtlantis\u201d" }).click();
    await atlantisSearch;
    await expect.poll(() => new URL(page.url()).searchParams.get("location")).toBe("Atlantis");
    await expect(page.locator('[data-loading="true"]')).toHaveCount(0);
    await page.waitForLoadState("networkidle");

    const clearedSearch = waitForLocationSearch(page, null);
    await page.getByRole("button", { name: "Clear location" }).click();
    await clearedSearch;
    await expect(input).toHaveValue("");
    await expect.poll(() => new URL(page.url()).searchParams.has("location")).toBe(false);
    await expect(page.locator('[data-loading="true"]')).toHaveCount(0);
    await page.waitForLoadState("networkidle");
  });

  test("commits trimmed text on blur and keeps fallback available after an error", async ({
    page,
  }) => {
    await page.route("**/api/v1/jobs/locations?**", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q");
      if (query === "Errorville") {
        await route.fulfill({ status: 503, contentType: "text/plain", body: "Unavailable" });
      } else {
        await fulfillLocations(route, []);
      }
    });
    await page.goto("/jobs?sort=newest");
    const input = page.getByRole("combobox", { name: "Location" });

    await input.fill("  Phoenix  ");
    const phoenixSearch = waitForLocationSearch(page, "Phoenix");
    await page.getByRole("searchbox", { name: "Search" }).focus();
    await phoenixSearch;
    await expect(input).toHaveValue("Phoenix");
    await expect.poll(() => new URL(page.url()).searchParams.get("location")).toBe("Phoenix");
    await expect(page.locator('[data-loading="true"]')).toHaveCount(0);
    await page.waitForLoadState("networkidle");

    await input.fill("Errorville");
    await expect(
      page.getByText("Suggestions unavailable. You can still use your exact text."),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Search for \u201cErrorville\u201d" }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
  });

  test("draws exactly one focus ring in both hero and filter rail", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: "Location" }).focus();
    expect(await outlinedElementCount(page, "Location")).toBe(1);
    expect(await compositeFocusPresentation(page, "Location")).toMatchObject({
      borderColor: "rgba(0, 0, 0, 0)",
      outlineOffset: "-2px",
      outlineWidth: "2px",
    });

    await page.goto("/jobs?sort=newest");
    await page.getByRole("combobox", { name: "Location" }).focus();
    expect(await outlinedElementCount(page, "Location")).toBe(1);
    expect(await compositeFocusPresentation(page, "Location")).toMatchObject({
      borderColor: "rgba(0, 0, 0, 0)",
      outlineOffset: "-2px",
      outlineWidth: "2px",
    });
  });

  test("canonicalizes a legacy Remote location URL without showing it as a place", async ({
    page,
  }) => {
    await page.goto("/jobs?location=Remote");

    await expect(page).toHaveURL(/\/jobs\?work=remote(?:&|$)/u);
    await expect(page.getByRole("combobox", { name: "Location" })).toHaveValue("");
    await expect(page.getByRole("button", { name: "Remote", pressed: true })).toBeVisible();
  });
});

test.describe("mobile location combobox", () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("keeps the popup inside the viewport without exposing the submit button underneath", async ({
    page,
  }) => {
    await page.route("**/api/v1/jobs/locations?**", async (route) => {
      await fulfillLocations(route, ["Phoenix, AZ"]);
    });
    await page.goto("/");
    const input = page.getByRole("combobox", { name: "Location" });
    await input.fill("Pho");
    await expect(page.getByRole("option", { name: "Phoenix, AZ" })).toBeVisible();

    const geometry = await input.evaluate((currentInput) => {
      const listbox = document.querySelector('[role="listbox"]');
      const popover = listbox?.parentElement;
      const submit = currentInput.closest("form")?.querySelector('button[type="submit"]');
      if (popover === undefined || popover === null || submit === undefined || submit === null) {
        return null;
      }
      const popupRect = popover.getBoundingClientRect();
      const submitRect = submit.getBoundingClientRect();
      return {
        coversSubmitTop: popupRect.top <= submitRect.top,
        insideViewport: popupRect.left >= 0 && popupRect.right <= window.innerWidth,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });

    expect(geometry).toEqual({
      coversSubmitTop: true,
      insideViewport: true,
      noHorizontalOverflow: true,
    });
  });
});
