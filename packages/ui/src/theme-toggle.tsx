"use client";

import { Moon, Sun } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { cx } from "./cx.js";

export type Theme = "light" | "dark";

export interface ThemeToggleProps {
  readonly className?: string;
  readonly onThemeChange?: (theme: Theme) => void;
  readonly theme?: Theme;
}

export function ThemeToggle({ className, onThemeChange, theme }: ThemeToggleProps) {
  const [uncontrolledTheme, setUncontrolledTheme] = useState<Theme | null>(null);
  const currentTheme = theme ?? uncontrolledTheme ?? "light";

  useEffect(() => {
    if (theme !== undefined) return;
    const persisted = window.localStorage.getItem("jobbbler-theme");
    const resolved: Theme =
      persisted === "dark" || persisted === "light"
        ? persisted
        : document.documentElement.dataset["theme"] === "dark"
          ? "dark"
          : "light";
    setUncontrolledTheme(resolved);
  }, [theme]);

  useEffect(() => {
    if (theme === undefined && uncontrolledTheme === null) return;
    document.documentElement.dataset["theme"] = currentTheme;
    if (theme === undefined) window.localStorage.setItem("jobbbler-theme", currentTheme);
  }, [currentTheme, theme, uncontrolledTheme]);

  const nextTheme: Theme = currentTheme === "light" ? "dark" : "light";
  return (
    <button
      aria-label={`Switch to ${nextTheme} theme`}
      aria-pressed={currentTheme === "dark"}
      className={cx("jb-theme-toggle", className)}
      onClick={() => {
        if (theme === undefined) setUncontrolledTheme(nextTheme);
        onThemeChange?.(nextTheme);
      }}
      type="button"
    >
      {currentTheme === "light" ? (
        <Moon aria-hidden="true" size={17} />
      ) : (
        <Sun aria-hidden="true" size={17} />
      )}
      <span className="jb-sr-only">Current theme: {currentTheme}</span>
    </button>
  );
}
