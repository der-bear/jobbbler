"use client";

import { type KeyboardEvent, useRef } from "react";

import styles from "./currency-selector.module.css";

export const displayCurrencies = ["USD", "EUR", "GBP", "CAD"] as const;
export type DisplayCurrency = (typeof displayCurrencies)[number];

export function isDisplayCurrency(value: string): value is DisplayCurrency {
  return displayCurrencies.some((currency) => currency === value);
}

function currencyForKeyboardKey(current: DisplayCurrency, key: string): DisplayCurrency | null {
  const currentIndex = displayCurrencies.indexOf(current);
  if (key === "Home") return displayCurrencies[0] ?? current;
  if (key === "End") return displayCurrencies[displayCurrencies.length - 1] ?? current;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return displayCurrencies[(currentIndex + 1) % displayCurrencies.length] ?? current;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (
      displayCurrencies[(currentIndex - 1 + displayCurrencies.length) % displayCurrencies.length] ??
      current
    );
  }
  return null;
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
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: DisplayCurrency) {
    const next = currencyForKeyboardKey(current, event.key);
    if (next === null) return;
    event.preventDefault();
    if (next !== value) onChange(next);
    radioRefs.current[displayCurrencies.indexOf(next)]?.focus();
  }

  return (
    <div aria-label={label} className={styles["selector"]} role="radiogroup">
      {displayCurrencies.map((currency, index) => (
        <button
          aria-checked={value === currency}
          key={currency}
          onClick={() => onChange(currency)}
          onKeyDown={(event) => handleKeyDown(event, currency)}
          ref={(element) => {
            radioRefs.current[index] = element;
          }}
          role="radio"
          tabIndex={value === currency ? 0 : -1}
          type="button"
        >
          {currency}
        </button>
      ))}
    </div>
  );
}
