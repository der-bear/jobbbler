"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import styles from "./copy-prompt-button.module.css";

export function CopyPromptButton({
  compact = false,
  text,
}: Readonly<{ compact?: boolean; text: string }>) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copyPrompt() {
    if (navigator.clipboard === undefined) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), 1_600);
  }

  return (
    <button
      aria-label={copied ? "Prompt copied" : "Copy prompt"}
      className={styles["button"]}
      data-compact={compact || undefined}
      onClick={() => void copyPrompt()}
      title={copied ? "Copied" : "Copy prompt"}
      type="button"
    >
      {copied ? (
        <CheckIcon aria-hidden="true" size={14} />
      ) : (
        <CopyIcon aria-hidden="true" size={14} />
      )}
      {copied ? "Copied" : "Copy prompt"}
    </button>
  );
}
