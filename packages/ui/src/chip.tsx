import { X } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "./cx.js";

/*
 * `tone` applies to the static form only. A descriptive chip carries no border —
 * an outline is what marks a control here — so tone is how a fact earns emphasis
 * without borrowing the affordance of something clickable.
 */
export type ChipTone = "neutral" | "signal";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  readonly children: ReactNode;
  readonly onRemove?: () => void;
  readonly selected?: boolean;
  readonly tone?: ChipTone;
}

export function Chip({
  children,
  className,
  onClick,
  onRemove,
  selected = false,
  tone = "neutral",
  ...props
}: ChipProps) {
  const content = <span className="jb-chip__label">{children}</span>;
  const interactive = onClick !== undefined;
  const classes = cx(
    "jb-chip",
    selected && "jb-chip--selected",
    !interactive && "jb-chip--static",
    !interactive && tone === "signal" && "jb-chip--signal",
    className,
  );

  if (onClick) {
    return (
      <button
        {...props}
        aria-pressed={selected}
        className={classes}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <span className={classes}>
      {content}
      {onRemove ? (
        <button
          aria-label={`Remove ${typeof children === "string" ? children : "filter"}`}
          className="jb-chip__remove"
          onClick={onRemove}
          type="button"
        >
          <X aria-hidden="true" size={14} weight="bold" />
        </button>
      ) : null}
    </span>
  );
}
