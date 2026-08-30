"use client";

import styles from "./currency-selector.module.css";

export const displayCurrencies = ["EUR", "USD", "GBP", "CAD"] as const;
export type DisplayCurrency = (typeof displayCurrencies)[number];

export function isDisplayCurrency(value: string): value is DisplayCurrency {
  return displayCurrencies.some((currency) => currency === value);
}

export function CurrencySelector({
  label = "Display currency",
  onChange,
  value,
}: Readonly<{
  label?: string;
  onChange: (value: DisplayCurrency) => void;
  value: DisplayCurrency;
}>) {
  return (
    <div aria-label={label} className={styles["selector"]} role="radiogroup">
      {displayCurrencies.map((currency) => (
        <button
          aria-checked={value === currency}
          key={currency}
          onClick={() => onChange(currency)}
          role="radio"
          type="button"
        >
          {currency}
        </button>
      ))}
    </div>
  );
}
