import type { ReactNode } from "react";

import { Dialog, type DialogProps } from "./dialog.js";

export interface SheetProps extends DialogProps {
  readonly side?: "bottom" | "right";
  readonly children: ReactNode;
}

export function Sheet({ className, side = "right", ...props }: SheetProps) {
  return (
    <Dialog
      {...props}
      className={["jb-sheet", `jb-sheet--${side}`, className].filter(Boolean).join(" ")}
    />
  );
}
