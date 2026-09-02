import { expect, test, type Page } from "@playwright/test";

async function createPrivateSession(page: Page): Promise<void> {
  if (page.url() === "about:blank") await page.goto("/");
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/v1/owners/session", { method: "POST" });
    return response.status;
  });
  expect(status).toBe(201);
}

test.describe("saved-search ownership workspace", () => {
  test("keeps the create route in a stable loading state before hydration", async ({ page }) => {
    const response = await page.request.get("/saved?q=platform&work=remote&create=1");
    expect(response.ok()).toBe(true);

    const markup = await response.text();
    expect(markup).toContain("Loading saved searches…");
    expect(markup).not.toContain("Nothing saved yet.");
  });

  test("starts search criteria and private-workspace creation together", async ({ page }) => {
    let releaseSearch!: () => void;
    const searchGate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    let searchStarted = false;
    let ownerSessionStarted = false;

    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/api/v1/owners/session") {
        ownerSessionStarted = true;
      }
    });
    await page.route("**/api/v1/jobs/search?**", async (route) => {
      searchStarted = true;
      await searchGate;
      await route.continue();
    });

    await page.goto("/saved?q=platform&work=remote&create=1");
    await expect.poll(() => searchStarted).toBe(true);
    try {
      await expect.poll(() => ownerSessionStarted, { timeout: 1_000 }).toBe(true);
    } finally {
      releaseSearch();
    }
  });

  test("removes a transient save confirmation after it has been read", async ({ page }) => {
    await page.goto("/saved?q=platform&work=remote&create=1");
    await page.clock.install();

    await page.getByRole("button", { name: "Save search" }).click();

    const confirmation = page.getByRole("status").filter({ hasText: "Search saved" });
    await expect(confirmation).toBeVisible();
    await page.clock.fastForward(5_001);
    await expect(confirmation).toBeHidden();
  });

  test("removes one exact saved search without deleting the private workspace", async ({
    page,
  }) => {
    await page.goto("/saved?q=platform&work=remote&create=1");

    const name = page.getByLabel("Search name");
    await expect(name).toBeEditable();
    const savedName = await name.inputValue();
    await page.getByRole("button", { name: "Save search" }).click();

    const card = page.getByRole("article").filter({ hasText: savedName });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: `Remove ${savedName}` }).click();

    const confirmation = card.getByRole("form", { name: `Remove ${savedName}` });
    const phrase = confirmation.getByLabel(`Type ${savedName} to confirm removal`);
    const remove = confirmation.getByRole("button", { name: "Remove saved search" });
    await expect(phrase).toBeFocused();
    await phrase.fill(`${savedName} `);
    await expect(remove).toBeDisabled();
    await phrase.fill(savedName);
    await expect(remove).toBeEnabled();
    await remove.click();

    await expect(card).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "No saved searches yet." })).toBeVisible();
    await expect(page.getByRole("region", { name: "Your saved searches" })).toBeFocused();
    await expect(page.getByRole("complementary", { name: "Saved search access" })).toBeVisible();
  });

  test("moves focus into recovery and deletion confirmation steps", async ({ page }) => {
    await page.goto("/saved");
    await page.getByText("Restore with email", { exact: true }).click();
    await page.getByLabel("Email you used before").fill("focus-check@example.test");
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByLabel("Six-digit code")).toBeFocused();

    await createPrivateSession(page);
    await page.goto("/saved");
    await page
      .getByRole("complementary", { name: "Saved search access" })
      .locator("details")
      .filter({ hasText: "Delete private data" })
      .locator("summary")
      .click();
    await page.getByLabel(/Type DELETE MY PRIVATE DATA/u).fill("DELETE MY PRIVATE DATA");
    await page.getByRole("button", { name: "Continue to final confirmation" }).click();
    await expect(page.getByLabel("Final confirmation")).toBeFocused();
  });

  test("adds optional workspace recovery without turning on email updates", async ({ page }) => {
    await createPrivateSession(page);
    await page.goto("/saved");

    const accessCard = page.getByRole("complementary", { name: "Saved search access" });
    await accessCard.getByText("Get back in from another device", { exact: true }).click();
    await accessCard
      .getByLabel("Email to get back in")
      .fill(`workspace-recovery-${String(Date.now())}@example.test`);
    await accessCard.getByRole("button", { name: "Send code" }).click();
    await expect(accessCard.getByLabel("Six-digit code")).toBeFocused();
    await expect(accessCard.getByRole("button", { name: "Verify" })).toBeEnabled();
    await accessCard.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByText("Email added", { exact: true })).toBeVisible();
    await expect(page.getByText("Access from another device", { exact: true })).toBeVisible();
    await expect(page.getByText("Get back in from another device", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Email updates are still optional.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("Email updates on", { exact: true })).toHaveCount(0);
  });

  test("explains the consequence before removing a verified email", async ({ page }) => {
    await createPrivateSession(page);
    await page.goto("/saved");

    const accessCard = page.getByRole("complementary", { name: "Saved search access" });
    await accessCard.getByText("Get back in from another device", { exact: true }).click();
    await accessCard
      .getByLabel("Email to get back in")
      .fill(`remove-email-${String(Date.now())}@example.test`);
    await accessCard.getByRole("button", { name: "Send code" }).click();
    await accessCard.getByRole("button", { name: "Verify" }).click();

    const removeEmail = accessCard.getByRole("button", { name: /Remove verified email/u });
    await expect(removeEmail).toBeVisible();
    await expect(accessCard.getByText("Remove email", { exact: true })).toBeVisible();
    await removeEmail.click();

    const confirmation = accessCard.getByRole("group", { name: "Remove verified email" });
    await expect(confirmation).toContainText(
      "Email updates using it will stop, and you will no longer be able to restore with it.",
    );
    await confirmation.getByRole("button", { name: "Keep email" }).click();
    await expect(removeEmail).toBeFocused();
  });

  test("keeps the page title aligned with the access card when recovery is expanded", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1_440, height: 1_200 });
    await createPrivateSession(page);
    await page.goto("/saved");
    await page.getByText("Get back in from another device", { exact: true }).click();

    const titleBox = await page
      .getByRole("heading", { name: "Saved searches", exact: true })
      .boundingBox();
    const accessBox = await page
      .getByRole("complementary", { name: "Saved search access" })
      .boundingBox();

    expect(titleBox).not.toBeNull();
    expect(accessBox).not.toBeNull();
    expect(Math.abs(titleBox!.y - accessBox!.y)).toBeLessThan(80);
  });

  test("edits an existing email-update schedule without creating a duplicate", async ({ page }) => {
    await page.goto("/saved?q=platform&work=remote&create=1");
    const savedSearchName = await page.getByLabel("Search name").inputValue();
    const composer = page.getByRole("region", { name: "Save this search" });
    const emailConsent = composer.getByLabel("Email me when results change");
    await emailConsent.check();
    await expect(emailConsent).toBeChecked();
    await composer
      .getByLabel("Your email")
      .fill(`schedule-edit-${String(Date.now())}@example.test`);
    await composer.getByRole("button", { name: "Send code" }).click();
    await expect(composer.getByLabel("Six-digit code")).toBeFocused();
    await expect(composer.getByRole("button", { name: "Verify and continue" })).toBeEnabled();
    await composer.getByRole("button", { name: "Verify and continue" }).click();

    await page.getByLabel("How often").selectOption("weekly");
    await page.getByLabel("Local time").fill("09:00");
    await page.getByLabel("Time zone").fill("Europe/Kyiv");
    await page.getByRole("button", { name: "Review email updates" }).click();
    await page.getByRole("button", { name: "Turn on email updates" }).click();

    const card = page.getByRole("article").filter({ hasText: savedSearchName });
    await expect(card).toBeVisible();
    const initialSchedules = await page.evaluate(async () => {
      const response = await fetch("/api/v1/schedules");
      return (await response.json()) as {
        data: readonly {
          id: string;
          version: number;
          delivery: { endpointId: string };
        }[];
      };
    });
    expect(initialSchedules.data).toHaveLength(1);

    await card.getByRole("button", { name: "Edit updates" }).click();
    await expect(page.getByRole("heading", { name: "Edit email updates" })).toBeVisible();
    await expect(page.getByLabel("How often")).toHaveValue("weekly");
    await expect(page.getByLabel("Monday")).toBeChecked();
    await expect(page.getByLabel("Wednesday")).toBeChecked();
    await expect(page.getByLabel("Friday")).toBeChecked();
    await expect(page.getByLabel("Local time")).toHaveValue("09:00");
    await expect(page.getByLabel("Time zone")).toHaveValue("Europe/Kyiv");
    await expect(page.getByLabel("Send updates to")).toHaveValue(
      initialSchedules.data[0]!.delivery.endpointId,
    );

    await page.getByLabel("How often").selectOption("daily");
    await page.getByLabel("Local time").fill("10:30");
    await page.getByRole("button", { name: "Review changes" }).click();
    await expect(page.getByRole("region", { name: "Review changes" })).toBeFocused();
    await expect(page.getByText("Weekly on Mon, Wed, Fri at 09:00 (Europe/Kyiv)")).toBeVisible();
    await expect(page.getByText("Daily at 10:30 (Europe/Kyiv)")).toBeVisible();

    const updateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `/api/v1/schedules/${initialSchedules.data[0]!.id}`,
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    expect((await updateResponse).ok()).toBe(true);

    const updatedSchedules = await page.evaluate(async () => {
      const response = await fetch("/api/v1/schedules");
      return (await response.json()) as {
        data: readonly {
          id: string;
          version: number;
          recurrence: { frequency: string; time: string; timeZone: string };
        }[];
      };
    });
    expect(updatedSchedules.data).toHaveLength(1);
    expect(updatedSchedules.data[0]).toMatchObject({
      id: initialSchedules.data[0]!.id,
      version: initialSchedules.data[0]!.version + 1,
      recurrence: { frequency: "daily", time: "10:30", timeZone: "Europe/Kyiv" },
    });
    await expect(card.getByRole("button", { name: "Edit updates" })).toBeFocused();

    await card.getByRole("button", { name: "Pause" }).click();
    await expect(card.getByText("Email updates paused", { exact: true })).toBeVisible();
    await expect(card.getByText("Checks are paused", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Resume" })).toBeVisible();

    await card.getByRole("button", { name: "Resume" }).click();
    await expect(card.getByText("Email updates on", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Pause" })).toBeVisible();
  });
});
