"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { cx } from "./cx.js";

export interface DialogProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly description?: ReactNode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
}

export function Dialog({
  children,
  className,
  description,
  onOpenChange,
  open,
  title,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-modal="true"
      className={cx("jb-dialog", className)}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => onOpenChange(false)}
      role="dialog"
    >
      <div className="jb-dialog__surface">
        <header className="jb-dialog__header">
          <div>
            <h2 className="jb-dialog__title" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className="jb-dialog__description" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Close dialog"
            className="jb-icon-button"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            <X aria-hidden="true" size={18} weight="bold" />
          </button>
        </header>
        <div className="jb-dialog__body">{children}</div>
      </div>
    </dialog>
  );
}
