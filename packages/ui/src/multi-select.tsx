"use client";

import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

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
  const [activeOption, setActiveOption] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const controlRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const reactId = useId();
  const listboxId = `multiselect-${reactId.replaceAll(":", "")}-listbox`;

  function close(returnFocus: boolean) {
    setOpen(false);
    setQuery("");
    setActiveOption(null);
    if (returnFocus) controlRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      close(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
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

  const tabStopIndex = Math.max(
    0,
    visibleOptions.findIndex(({ value }) =>
      activeOption === null ? selected.includes(value) : value === activeOption,
    ),
  );

  useEffect(() => {
    if (!open || searchable || visibleOptions.length === 0) return;
    const option = visibleOptions[tabStopIndex];
    if (option === undefined) return;
    optionRefs.current.get(option.value)?.focus();
  }, [open, searchable, tabStopIndex, visibleOptions]);

  function toggle(value: string) {
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    );
  }

  function focusOption(index: number) {
    const option = visibleOptions[index];
    if (option === undefined) return;
    setActiveOption(option.value);
    optionRefs.current.get(option.value)?.focus();
  }

  function handleOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption((index + 1) % visibleOptions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption((index - 1 + visibleOptions.length) % visibleOptions.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(visibleOptions.length - 1);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const option = visibleOptions[index];
      if (option !== undefined) toggle(option.value);
    }
  }

  const currentSelectionLabel = selectionLabel(options, selected, placeholder);

  return (
    <div className="jb-multiselect" ref={rootRef}>
      <button
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}: ${currentSelectionLabel}`}
        className="jb-multiselect__control"
        data-active={String(selected.length > 0)}
        onClick={() => {
          if (open) close(false);
          else setOpen(true);
        }}
        ref={controlRef}
        type="button"
      >
        <span>{currentSelectionLabel}</span>
        <CaretDownIcon aria-hidden="true" data-open={open} size={12} />
      </button>
      {open ? (
        <div className="jb-multiselect__popover">
          {searchable ? (
            <input
              aria-label={`Search ${label.toLowerCase()} options`}
              autoFocus
              className="jb-multiselect__search"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" || visibleOptions.length === 0) return;
                event.preventDefault();
                focusOption(tabStopIndex);
              }}
              placeholder="Type to filter…"
              type="search"
              value={query}
            />
          ) : null}
          <ul
            aria-label={`${label} options`}
            aria-multiselectable="true"
            className="jb-multiselect__list"
            id={listboxId}
            role="listbox"
          >
            {visibleOptions.length === 0 ? (
              <li className="jb-multiselect__empty" role="presentation">
                No matching options.
              </li>
            ) : (
              visibleOptions.map((option, index) => (
                <li key={option.value} role="presentation">
                  <button
                    aria-selected={selected.includes(option.value)}
                    className="jb-multiselect__option"
                    onClick={() => toggle(option.value)}
                    onFocus={() => setActiveOption(option.value)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index)}
                    ref={(element) => {
                      if (element === null) optionRefs.current.delete(option.value);
                      else optionRefs.current.set(option.value, element);
                    }}
                    role="option"
                    tabIndex={index === tabStopIndex ? 0 : -1}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="jb-multiselect__indicator"
                      data-selected={String(selected.includes(option.value))}
                    >
                      {selected.includes(option.value) ? (
                        <CheckIcon size={11} weight="bold" />
                      ) : null}
                    </span>
                    <span>{option.label}</span>
                  </button>
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
