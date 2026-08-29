import { expect, test, type Page } from "@playwright/test";

const exampleOutcome = "senior full-stack engineer";
const seededSearch =
  "/?q=senior+full-stack+engineer&category=software_engineering&work=remote&seniority=senior&location=Europe&salary_min=100000&currency=EUR&exclude=agency";

const seededRole = {
  company: "Jobbbler Demo Systems",
  title: "Senior Full-Stack Engineer",
} as const;

function resultCard(page: Page, title: string, company: string) {
  return page.getByRole("article", { name: `${title} at ${company}` });
}

test.describe("public job search workspace", () => {
  test("shows signed-out users explainable, sourced search results", async ({ page }) => {
    await page.goto(seededSearch);

    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("link", { name: "Jobbbler", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search jobs" })).toHaveValue(
      "senior full-stack engineer",
    );
    await expect(page.getByRole("status", { name: "Search status" })).toContainText(/matches/i);

    const role = resultCard(page, seededRole.title, seededRole.company);
    await expect(role).toBeVisible();
    await expect(role.getByText(/updated|ago/i)).toBeVisible();
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
    await expect(page.getByRole("status", { name: "Search status" })).toContainText(/matches/i);
  });

  test("keeps URL-backed filters editable through the visible controls", async ({ page }) => {
    await page.goto(seededSearch);

    await page.getByRole("button", { name: "Remote", pressed: true }).click();

    await expect(page).not.toHaveURL(/(?:\?|&)work=remote(?:&|$)/);
    await expect(page.getByRole("status", { name: "Search status" })).toContainText(/matches/i);
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
    await expect(page.getByRole("region", { name: "Why this matches" })).toContainText(
      "Work model is remote.",
    );
    await expect(page.getByRole("region", { name: "Source and freshness" })).toContainText(
      /Jobbbler demo|source/i,
    );
    await expect(page.getByRole("region", { name: "Source and freshness" })).toContainText(
      "Handled on Jobbbler",
    );
  });

  test("persists the selected theme after a reload", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
  });

  test("remains usable when WebMCP is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "modelContext", { configurable: true, value: undefined });
    });
    await page.goto("/");

    await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(/unavailable/i);
    const outcome = page.getByRole("searchbox", { name: "Search jobs" });
    await outcome.fill(exampleOutcome);
    await outcome.press("Enter");

    await expect(page.getByRole("status", { name: "Search status" })).toContainText(/matches/i);
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

    await expect(page.getByRole("searchbox", { name: "Search jobs" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remote", pressed: true })).toBeVisible();
    await expect(resultCard(page, seededRole.title, seededRole.company)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });

  test("does not leave decorative animations running for reduced-motion users", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(seededSearch);

    await expect(page.getByRole("status", { name: "Search status" })).toContainText(/matches/i);
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
});
