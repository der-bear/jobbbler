import { useId, type InputHTMLAttributes } from "react";

import { cx } from "./cx.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label?: string;
  readonly hint?: string;
  readonly error?: string;
}

export function Input({ className, error, hint, id, label, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? `jb-input-${generatedId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="jb-field">
      {label ? (
        <label className="jb-field__label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input
        {...props}
        id={inputId}
        aria-describedby={describedBy || undefined}
        aria-invalid={Boolean(error) || undefined}
        className={cx("jb-input", error && "jb-input--invalid", className)}
      />
      {hint ? (
        <p className="jb-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="jb-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
