"use client";

import { MapPinIcon } from "@phosphor-icons/react";
import { useId, useMemo, useState, type FocusEvent, type KeyboardEvent } from "react";

import styles from "./location-combobox.module.css";

const featuredLocations = ["Remote", "Global", "Europe"] as const;

function uniqueLocations(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase("en");
    if (trimmed.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function locationSuggestions(options: readonly string[], query: string): readonly string[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("en");
  const ordered =
    normalizedQuery.length === 0
      ? uniqueLocations([...featuredLocations, ...options])
      : uniqueLocations([...options, ...featuredLocations]).filter((option) =>
          option.toLocaleLowerCase("en").includes(normalizedQuery),
        );
  return ordered.slice(0, 7);
}

export interface LocationComboboxProps {
  readonly label?: string;
  readonly onChange: (value: string) => void;
  readonly onCommit: (value: string) => void;
  readonly options: readonly string[];
  readonly placeholder?: string;
  readonly value: string;
}

export function LocationCombobox({
  label = "Location",
  onChange,
  onCommit,
  options,
  placeholder = "City, country, or remote",
  value,
}: LocationComboboxProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions = useMemo(() => locationSuggestions(options, value), [options, value]);
  const activeOption = suggestions[activeIndex];

  function choose(option: string) {
    onChange(option);
    onCommit(option);
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(current + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      if (open && activeOption !== undefined) {
        event.preventDefault();
        choose(activeOption);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setOpen(false);
    onCommit(value.trim());
  }

  return (
    <div className={styles["combobox"]} onBlur={handleBlur}>
      <label className="sr-only" htmlFor={`${id}-input`}>
        {label}
      </label>
      <div className={styles["field"]}>
        <MapPinIcon aria-hidden="true" size={17} />
        <input
          aria-activedescendant={
            open && activeOption !== undefined ? `${id}-option-${String(activeIndex)}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={`${id}-listbox`}
          aria-expanded={open}
          aria-label={label}
          autoComplete="off"
          id={`${id}-input`}
          maxLength={120}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          value={value}
        />
      </div>
      {open && suggestions.length > 0 ? (
        <ul className={styles["options"]} id={`${id}-listbox`} role="listbox">
          {suggestions.map((option, index) => (
            <li key={option} role="presentation">
              <button
                aria-selected={index === activeIndex}
                id={`${id}-option-${String(index)}`}
                onClick={() => choose(option)}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                type="button"
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
