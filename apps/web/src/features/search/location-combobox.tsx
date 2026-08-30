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

export function locationSuggestions(options: readonly string[], query: string): readonly string[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("en");
  const ordered =
    normalizedQuery.length === 0
      ? uniqueLocations([...featuredLocations, ...options])
      : uniqueLocations([...options, ...featuredLocations]).filter((option) =>
          option.toLocaleLowerCase("en").includes(normalizedQuery),
        );
  if (normalizedQuery.length > 0 && ordered.length === 0) return [query.trim()];
  return ordered.slice(0, 7);
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
  const normalizedQuery = query.trim();
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
  const suggestions = useMemo(
    () => locationSuggestions([...options, ...loadedOptions], value),
    [loadedOptions, options, value],
  );
  const activeOption = activeIndex < 0 ? undefined : suggestions[activeIndex];

  useEffect(() => {
    if (!open) return undefined;
    if (query.length === 0) {
      setLoadedOptions([]);
      setLoadStatus("ready");
      return undefined;
    }
    const cacheKey = query.toLocaleLowerCase("en");
    const cached = cache.current.get(cacheKey);
    if (cached !== undefined) {
      setLoadedOptions(cached);
      setLoadStatus("ready");
      return undefined;
    }

    const controller = new AbortController();
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

  function choose(option: string) {
    onChange(option);
    onCommit(option);
    setOpen(false);
    setActiveIndex(-1);
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
      <div className={styles["field"]}>
        <MapPinIcon aria-hidden="true" size={17} />
        <input
          aria-activedescendant={
            open && activeOption !== undefined ? `${id}-option-${String(activeIndex)}` : undefined
          }
          aria-autocomplete="list"
          aria-busy={loadStatus === "loading"}
          aria-controls={`${id}-listbox`}
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
              setOpen(true);
              setActiveIndex(-1);
            }}
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
              ? `${String(suggestions.length)} location suggestions available.`
              : ""}
      </span>
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
                tabIndex={-1}
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
