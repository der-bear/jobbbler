import type { HTMLAttributes } from "react";

import { cx } from "./cx.js";

export interface SkeletonProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  "aria-busy" | "aria-label" | "role"
> {
  readonly shape?: "line" | "circle" | "block";
}

export function Skeleton({ className, shape = "line", ...props }: SkeletonProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={cx("jb-skeleton", `jb-skeleton--${shape}`, className)}
    />
  );
}
