import { expect, test, type Page } from "@playwright/test";

import { collectPageErrors } from "./page-errors";

const pageErrors = new WeakMap<Page, () => readonly string[]>();

test.beforeEach(async ({ page }) => {
  pageErrors.set(
    page,
    collectPageErrors(page, {
      expectedHttpErrors: [{ method: "GET", pathname: "/api/v1/owners/activity", status: 401 }],
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
  const control = page.locator(".jb-multiselect__control").first();
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
  const group = page.getByRole("radiogroup", { name: "Display currency" });
  const eur = group.getByRole("radio", { name: "EUR" });
  const usd = group.getByRole("radio", { name: "USD" });
  const cad = group.getByRole("radio", { name: "CAD" });

  await expect(eur).toHaveAttribute("aria-checked", "true");
  await expect(eur).toHaveAttribute("tabindex", "0");
  await expect(group.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);

  await eur.focus();
  await eur.press("ArrowRight");
  await expect(usd).toHaveAttribute("aria-checked", "true");
  await expect(usd).toBeFocused();
  await expect(group.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);

  await usd.press("End");
  await expect(cad).toHaveAttribute("aria-checked", "true");
  await expect(cad).toBeFocused();

  await cad.press("Home");
  await expect(eur).toHaveAttribute("aria-checked", "true");
  await expect(eur).toBeFocused();

  await eur.press("ArrowLeft");
  await expect(cad).toHaveAttribute("aria-checked", "true");
  await expect(cad).toBeFocused();
});
