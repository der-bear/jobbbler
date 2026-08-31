"use client";

import { MapPinIcon, XIcon } from "@phosphor-icons/react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

import {
  locationSuggestionsResultSchema,
  type LocationSuggestionsResult,
} from "@jobbbler/contracts";
import { canonicalizeLocation } from "@jobbbler/jobs-domain";

import { queryApi } from "@/lib/query-client";

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

function locationMatchPriority(option: string, normalizedQuery: string): number {
  const normalizedOption = option.toLocaleLowerCase("en");
  if (normalizedOption === normalizedQuery) return 0;
  if (normalizedOption.startsWith(normalizedQuery)) return 1;
  return 2;
}

export function locationSuggestions(options: readonly string[], query: string): readonly string[] {
  const trimmedQuery = query.trim();
  const canonicalQuery = canonicalizeLocation(trimmedQuery);
  const normalizedQuery = canonicalQuery.toLocaleLowerCase("en");
  const aliasChoice = canonicalQuery === trimmedQuery ? [] : [canonicalQuery];
  const canonicalOptions = options.map(canonicalizeLocation);
  const ordered =
    normalizedQuery.length === 0
      ? uniqueLocations([...featuredLocations, ...canonicalOptions])
      : uniqueLocations([...aliasChoice, ...canonicalOptions, ...featuredLocations])
          .map((option, index) => ({ option, index }))
          .filter(({ option }) => option.toLocaleLowerCase("en").includes(normalizedQuery))
          .sort(
            (left, right) =>
              locationMatchPriority(left.option, normalizedQuery) -
                locationMatchPriority(right.option, normalizedQuery) || left.index - right.index,
          )
          .map(({ option }) => option);
  return ordered.slice(0, 7);
}

export interface LocationSuggestionItem {
  readonly kind: "suggestion" | "free-text";
  readonly label: string;
  readonly value: string;
}

export function locationSuggestionItems(
  options: readonly string[],
  query: string,
): readonly LocationSuggestionItem[] {
  const queryValue = query.trim();
  const suggestions = locationSuggestions(options, queryValue);
  const items: LocationSuggestionItem[] = suggestions.map((value) => ({
    kind: "suggestion",
    label: value,
    value,
  }));
  if (queryValue.length === 0) return items;

  const canonicalQuery = canonicalizeLocation(queryValue).toLocaleLowerCase("en");
  const hasExactSuggestion = suggestions.some(
    (value) => canonicalizeLocation(value).toLocaleLowerCase("en") === canonicalQuery,
  );
  if (!hasExactSuggestion) {
    items.push({
      kind: "free-text",
      label: `Search for \u201c${queryValue}\u201d`,
      value: queryValue,
    });
  }
  return items;
}

type LocationSuggestionRequest = (
  url: string,
  schema: typeof locationSuggestionsResultSchema,
  options: Readonly<{ signal: AbortSignal }>,
) => Promise<LocationSuggestionsResult>;

export async function fetchLocationSuggestions(
  query: string,
  signal: AbortSignal,
  request: LocationSuggestionRequest = queryApi,
): Promise<readonly string[]> {
  const normalizedQuery = canonicalizeLocation(query);
  if (normalizedQuery.length === 0) return [];
  const parameters = new URLSearchParams({ q: normalizedQuery, limit: "8" });
  const result = await request(
    `/api/v1/jobs/locations?${parameters.toString()}`,
    locationSuggestionsResultSchema,
    { signal },
  );
  return result.locations;
}

export interface LocationComboboxProps {
  readonly label?: string;
  readonly loadOptions?: (query: string, signal: AbortSignal) => Promise<readonly string[]>;
  readonly onChange: (value: string) => void;
  readonly onCommit: (value: string) => void;
  readonly options?: readonly string[];
  readonly placeholder?: string;
  readonly value: string;
}

export function LocationCombobox({
  label = "Location",
  loadOptions = fetchLocationSuggestions,
  onChange,
  onCommit,
  options = [],
  placeholder = "City, country, or remote",
  value,
}: LocationComboboxProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loadedOptions, setLoadedOptions] = useState<readonly string[]>([]);
  const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const cache = useRef(new Map<string, readonly string[]>());
  const query = value.trim();
  const suggestionItems = useMemo(
    () => locationSuggestionItems([...options, ...loadedOptions], value),
    [loadedOptions, options, value],
  );
  const activeOption = activeIndex < 0 ? undefined : suggestionItems[activeIndex];
  const hasKnownSuggestion = suggestionItems.some(({ kind }) => kind === "suggestion");

  useEffect(() => {
    if (!open) return undefined;
    if (query.length === 0) {
      setLoadedOptions([]);
      setLoadStatus("ready");
      return undefined;
    }
    const cacheKey = canonicalizeLocation(query).toLocaleLowerCase("en");
    const cached = cache.current.get(cacheKey);
    if (cached !== undefined) {
      setLoadedOptions(cached);
      setLoadStatus("ready");
      return undefined;
    }

    const controller = new AbortController();
    setLoadedOptions([]);
    setLoadStatus("loading");
    const timer = window.setTimeout(() => {
      void loadOptions(query, controller.signal)
        .then((nextOptions) => {
          if (controller.signal.aborted) return;
          cache.current.set(cacheKey, nextOptions);
          setLoadedOptions(nextOptions);
          setLoadStatus("ready");
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setLoadedOptions([]);
          setLoadStatus("error");
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadOptions, open, query]);

  useEffect(() => {
    setActiveIndex((current) =>
      current >= suggestionItems.length ? suggestionItems.length - 1 : current,
    );
  }, [suggestionItems.length]);

  function choose(option: LocationSuggestionItem) {
    onChange(option.value);
    onCommit(option.value);
    setOpen(false);
    setActiveIndex(-1);
  }

  function moveActive(direction: 1 | -1) {
    setActiveIndex((current) => {
      if (suggestionItems.length === 0) return -1;
      if (current < 0) return direction === 1 ? 0 : suggestionItems.length - 1;
      return (current + direction + suggestionItems.length) % suggestionItems.length;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      moveActive(-1);
    } else if (event.key === "Home" && open && suggestionItems.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && open && suggestionItems.length > 0) {
      event.preventDefault();
      setActiveIndex(suggestionItems.length - 1);
    } else if (event.key === "Enter") {
      if (open && activeOption !== undefined) {
        event.preventDefault();
        choose(activeOption);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setOpen(false);
    setActiveIndex(-1);
    const committedValue = value.trim();
    if (committedValue !== value) onChange(committedValue);
    onCommit(committedValue);
  }

  const visibleStatus =
    loadStatus === "loading"
      ? "Looking up locations\u2026"
      : loadStatus === "error"
        ? "Suggestions unavailable. You can still use your exact text."
        : query.length > 0 && !hasKnownSuggestion
          ? "No listed location matches yet. You can still search this place."
          : null;

  return (
    <div className={styles["combobox"]} onBlur={handleBlur}>
      <div className={styles["field"]}>
        <MapPinIcon aria-hidden="true" size={17} />
        <input
          aria-activedescendant={
            open && activeOption !== undefined ? `${id}-option-${String(activeIndex)}` : undefined
          }
          aria-autocomplete="list"
          aria-busy={loadStatus === "loading" || undefined}
          aria-controls={open ? `${id}-listbox` : undefined}
          aria-describedby={`${id}-status`}
          aria-expanded={open}
          aria-label={label}
          autoComplete="off"
          id={`${id}-input`}
          maxLength={120}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          value={value}
        />
        {value.length > 0 ? (
          <button
            aria-label="Clear location"
            className={styles["clearButton"]}
            onClick={() => {
              onChange("");
              onCommit("");
              setOpen(false);
              setActiveIndex(-1);
            }}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            <XIcon aria-hidden="true" size={13} />
          </button>
        ) : null}
      </div>
      <span className="sr-only" id={`${id}-status`} role="status">
        {loadStatus === "loading"
          ? "Loading location suggestions."
          : loadStatus === "error"
            ? "Suggestions are unavailable. You can still enter any location."
            : open
              ? `${String(suggestionItems.length)} location suggestions available.`
              : ""}
      </span>
      {open ? (
        <div className={styles["popover"]}>
          {visibleStatus === null ? null : (
            <p aria-hidden="true" className={styles["lookupStatus"]} data-state={loadStatus}>
              {visibleStatus}
            </p>
          )}
          <ul
            aria-label={`${label} suggestions`}
            className={styles["options"]}
            id={`${id}-listbox`}
            role="listbox"
          >
            {suggestionItems.map((option, index) => (
              <li
                aria-selected={index === activeIndex}
                data-kind={option.kind}
                id={`${id}-option-${String(index)}`}
                key={`${option.kind}:${option.value}`}
                onClick={() => choose(option)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActiveIndex(index)}
                role="option"
              >
                <span>{option.label}</span>
                {option.kind === "free-text" ? (
                  <span aria-hidden="true" className={styles["optionMeta"]}>
                    As typed
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
