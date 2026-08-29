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
