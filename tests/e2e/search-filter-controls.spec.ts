import { expect, test, type Page } from "@playwright/test";

import { collectPageErrors } from "./page-errors";

const pageErrors = new WeakMap<Page, () => readonly string[]>();

test.beforeEach(async ({ page }) => {
  pageErrors.set(
    page,
    collectPageErrors(page, {
      expectedHttpErrors: [{ method: "GET", pathname: "/api/v1/owners/activity", status: 401 }],
      expectedRequestFailures: [
        {
          method: "GET",
          pathname: "/api/v1/jobs/search",
          errorText: "net::ERR_ABORTED",
        },
      ],
    }),
  );
  await page.goto("/jobs?sort=newest");
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)?.() ?? [], "Browser errors").toEqual([]);
});

test("multi-select exposes one named multi-value listbox and returns focus on Escape", async ({
  page,
}) => {
  const control = page.getByRole("button", { name: /^Function:/u });
  await expect(control).toHaveAccessibleName("Function: Any function");

  await control.click();
  const listbox = page.getByRole("listbox", { name: "Function options" });
  await expect(listbox).toHaveAttribute("aria-multiselectable", "true");

  const product = page.getByRole("option", { name: "Product" });
  await expect(product).toHaveAttribute("aria-selected", "false");
  await product.click();
  await expect(product).toHaveAttribute("aria-selected", "true");

  await page.getByRole("searchbox", { name: "Search function options" }).press("Escape");
  await expect(listbox).toBeHidden();
  await expect(control).toBeFocused();
  await expect(control).toHaveAccessibleName("Function: Product");
});

test("currency selector uses one tab stop and the complete radio-group keyboard contract", async ({
  page,
}) => {
  // Order is USD, EUR, GBP, CAD; USD is the default display currency.
  const group = page.getByRole("radiogroup", { name: "Display currency" });
  const usd = group.getByRole("radio", { name: "USD" });
  const eur = group.getByRole("radio", { name: "EUR" });
  const cad = group.getByRole("radio", { name: "CAD" });

  await expect(usd).toHaveAttribute("aria-checked", "true");
  await expect(usd).toHaveAttribute("tabindex", "0");
  await expect(group.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);

  await usd.focus();
  await usd.press("ArrowRight");
  await expect(eur).toHaveAttribute("aria-checked", "true");
  await expect(eur).toBeFocused();
  await expect(group.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);

  await eur.press("End");
  await expect(cad).toHaveAttribute("aria-checked", "true");
  await expect(cad).toBeFocused();

  await cad.press("Home");
  await expect(usd).toHaveAttribute("aria-checked", "true");
  await expect(usd).toBeFocused();

  await usd.press("ArrowLeft");
  await expect(cad).toHaveAttribute("aria-checked", "true");
  await expect(cad).toBeFocused();
});
