import { expect, test, type Page } from "@playwright/test";

async function createPrivateSession(page: Page): Promise<void> {
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

  test("starts independent criteria and ownership requests together", async ({ page }) => {
    let releaseSearch!: () => void;
    const searchGate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    let searchStarted = false;
    let ownerSessionStarted = false;

    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/v1/owners/session") {
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
    await expect(page.getByText("Privacy & access", { exact: true })).toBeVisible();
  });

  test("moves focus into recovery and deletion confirmation steps", async ({ page }) => {
    await page.goto("/saved");
    await page.getByText("Restore with email", { exact: true }).click();
    await page.getByLabel("Verified email").fill("focus-check@example.test");
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByLabel("Six-digit code")).toBeFocused();

    await createPrivateSession(page);
    await page.goto("/saved");
    await page.getByText("Privacy & access", { exact: true }).click();
    await page.getByLabel(/Type DELETE MY PRIVATE DATA/u).fill("DELETE MY PRIVATE DATA");
    await page.getByRole("button", { name: "Continue to final confirmation" }).click();
    await expect(page.getByLabel("Final confirmation")).toBeFocused();
  });

  test("adds optional workspace recovery without turning on email updates", async ({ page }) => {
    await createPrivateSession(page);
    await page.goto("/saved");

    await page.getByText("Keep access on other devices", { exact: true }).click();
    await page
      .getByLabel("Email address")
      .fill(`workspace-recovery-${String(Date.now())}@example.test`);
    await page.getByRole("button", { name: "Send verification code" }).click();
    await expect(page.getByLabel("Six-digit code")).toBeFocused();
    await expect(page.getByRole("button", { name: "Verify email" })).toBeEnabled();
    await page.getByRole("button", { name: "Verify email" }).click();

    await expect(page.getByText("Recovery is ready", { exact: true })).toBeVisible();
    await expect(page.getByText("Keep access on other devices", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Email updates remain optional.", { exact: false })).toBeVisible();
    await expect(page.getByText("Email updates on", { exact: true })).toHaveCount(0);
  });

  test("edits an existing email-update schedule without creating a duplicate", async ({ page }) => {
    await page.goto("/saved?q=platform&work=remote&create=1");
    await page.getByLabel("Email me when results change").check();
    await page.getByLabel("Email address").fill(`schedule-edit-${String(Date.now())}@example.test`);
    await page.getByRole("button", { name: "Send verification code" }).click();
    await page.getByRole("button", { name: "Verify and continue" }).click();

    await page.getByLabel("How often").selectOption("weekly");
    await page.getByLabel("Local time").fill("09:00");
    await page.getByLabel("Time zone").fill("Europe/Kyiv");
    await page.getByRole("button", { name: "Review email updates" }).click();
    await page.getByRole("button", { name: "Turn on email updates" }).click();

    const card = page.getByRole("article").filter({ hasText: "Email updates on" });
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
  });
});
