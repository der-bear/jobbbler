import { X } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "./cx.js";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  readonly children: ReactNode;
  readonly onRemove?: () => void;
  readonly selected?: boolean;
}

export function Chip({
  children,
  className,
  onClick,
  onRemove,
  selected = false,
  ...props
}: ChipProps) {
  const content = <span className="jb-chip__label">{children}</span>;
  const classes = cx("jb-chip", selected && "jb-chip--selected", className);

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
