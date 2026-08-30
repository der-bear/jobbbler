"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import styles from "./copy-prompt-button.module.css";

export function CopyPromptButton({
  compact = false,
  text,
}: Readonly<{ compact?: boolean; text: string }>) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  /*
   * Clipboard access can be denied outright (insecure context, blocked
   * permission, embedded viewer). The button must never look inert in that
   * case, so it falls back to a selection copy and then says plainly that the
   * text has to be copied by hand.
   */
  function legacyCopy(): boolean {
    const holder = document.createElement("textarea");
    holder.value = text;
    holder.setAttribute("readonly", "");
    holder.style.position = "fixed";
    holder.style.opacity = "0";
    document.body.append(holder);
    holder.select();
    let copied: boolean;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    holder.remove();
    return copied;
  }

  function announce(next: "copied" | "failed") {
    setState(next);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(
      () => setState("idle"),
      next === "copied" ? 1_600 : 4_000,
    );
  }

  async function copyPrompt() {
    try {
      if (navigator.clipboard === undefined) throw new Error("Clipboard is unavailable.");
      await navigator.clipboard.writeText(text);
      announce("copied");
    } catch {
      announce(legacyCopy() ? "copied" : "failed");
    }
  }

  const label =
    state === "copied" ? "Copied" : state === "failed" ? "Select the text to copy" : "Copy prompt";

  return (
    <button
      aria-label={state === "copied" ? "Prompt copied" : label}
      className={styles["button"]}
      data-compact={compact || undefined}
      data-state={state}
      onClick={() => void copyPrompt()}
      title={label}
      type="button"
    >
      {state === "copied" ? (
        <CheckIcon aria-hidden="true" size={14} />
      ) : (
        <CopyIcon aria-hidden="true" size={14} />
      )}
      {label}
      <span aria-live="polite" className="sr-only">
        {state === "copied"
          ? "Prompt copied."
          : state === "failed"
            ? "Copying was blocked. Select the prompt text and copy it manually."
            : ""}
      </span>
    </button>
  );
}
