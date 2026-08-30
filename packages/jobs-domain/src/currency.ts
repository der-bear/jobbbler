import type { SalaryRange } from "@jobbbler/contracts";

/**
 * Approximate mid-market rates, pinned so that cross-currency salary
 * comparisons stay deterministic and reproducible in tests and demos.
 * Values express how many EUR one unit of the currency is worth.
 */
const EUR_PER_UNIT: Readonly<Record<string, number>> = {
  EUR: 1,
  USD: 0.86,
  GBP: 1.16,
  CAD: 0.63,
};

/** Currencies that cross-currency salary ranking can convert between. */
export const comparableCurrencies: readonly string[] = Object.keys(EUR_PER_UNIT);

export function convertSalaryAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
): number | null {
  if (fromCurrency === toCurrency) return amount;
  const fromRate = EUR_PER_UNIT[fromCurrency];
  const toRate = EUR_PER_UNIT[toCurrency];
  if (fromRate === undefined || toRate === undefined) return null;
  return Math.round((amount * fromRate) / toRate);
}

/**
 * Produces one deterministic annual EUR value for cross-currency salary ordering.
 * A full-time hourly amount uses 2,080 hours per year; unavailable or unsupported
 * compensation stays at the same sentinel used for undisclosed salaries.
 */
export function annualizedSalarySortValue(salary: SalaryRange | null): number {
  if (salary === null) return -1;
  const amount = salary.maximum ?? salary.minimum;
  if (amount === null) return -1;
  const eurAmount = convertSalaryAmount(amount, salary.currency, "EUR");
  if (eurAmount === null) return -1;
  const annualMultiplier = salary.period === "hour" ? 2_080 : salary.period === "month" ? 12 : 1;
  return eurAmount * annualMultiplier;
}
