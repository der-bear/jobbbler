import { CircleNotch } from "@phosphor-icons/react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "./cx.js";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "primary" | "secondary" | "quiet" | "danger";
  readonly size?: "sm" | "md" | "lg";
  readonly leadingIcon?: ReactNode;
  readonly trailingIcon?: ReactNode;
  readonly loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    disabled,
    leadingIcon,
    loading = false,
    size = "md",
    trailingIcon,
    type = "button",
    variant = "primary",
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      aria-busy={loading || undefined}
      className={cx("jb-button", `jb-button--${variant}`, `jb-button--${size}`, className)}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? (
        <CircleNotch aria-hidden="true" className="jb-button__spinner" weight="bold" />
      ) : (
        leadingIcon
      )}
      <span className="jb-button__label">{children}</span>
      {!loading ? trailingIcon : null}
    </button>
  );
});
