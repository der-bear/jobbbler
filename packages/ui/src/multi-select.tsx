"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface MultiSelectOption {
  readonly value: string;
  readonly label: string;
}

export interface MultiSelectProps {
  readonly label: string;
  readonly options: readonly MultiSelectOption[];
  readonly placeholder: string;
  readonly searchable?: boolean;
  readonly selected: readonly string[];
  readonly onChange: (selected: readonly string[]) => void;
}

function selectionLabel(
  options: readonly MultiSelectOption[],
  selected: readonly string[],
  placeholder: string,
): string {
  if (selected.length === 0) return placeholder;
  if (selected.length === 1) {
    return options.find(({ value }) => value === selected[0])?.label ?? placeholder;
  }
  const labels = selected
    .slice(0, 2)
    .map((value) => options.find((option) => option.value === value)?.label ?? value);
  const remainder = selected.length - labels.length;
  return `${labels.join(", ")}${remainder === 0 ? "" : ` +${String(remainder)}`}`;
}

export function MultiSelect({
  label,
  options,
  placeholder,
  searchable = false,
  selected,
  onChange,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return options;
    return options.filter(({ label: optionLabel }) => optionLabel.toLowerCase().includes(needle));
  }, [options, query]);

  function toggle(value: string) {
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    );
  }

  return (
    <div className="jb-multiselect" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="jb-multiselect__control"
        data-active={String(selected.length > 0)}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{selectionLabel(options, selected, placeholder)}</span>
        <svg aria-hidden="true" fill="currentColor" height="12" viewBox="0 0 256 256" width="12">
          <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
        </svg>
      </button>
      {open ? (
        <div className="jb-multiselect__popover">
          {searchable ? (
            <input
              aria-label={`Search ${label.toLowerCase()} options`}
              autoFocus
              className="jb-multiselect__search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type to filter…"
              type="search"
              value={query}
            />
          ) : null}
          <ul aria-label={`${label} options`} className="jb-multiselect__list" role="listbox">
            {visibleOptions.length === 0 ? (
              <li className="jb-multiselect__empty">No matching options.</li>
            ) : (
              visibleOptions.map((option) => (
                <li key={option.value}>
                  <label>
                    <input
                      checked={selected.includes(option.value)}
                      onChange={() => toggle(option.value)}
                      type="checkbox"
                    />
                    <span>{option.label}</span>
                  </label>
                </li>
              ))
            )}
          </ul>
          {selected.length > 0 ? (
            <button className="jb-multiselect__clear" onClick={() => onChange([])} type="button">
              Clear selection
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
