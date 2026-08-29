import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx.js";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title?: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

export function Card({ action, children, className, eyebrow, title, ...props }: CardProps) {
  return (
    <section {...props} className={cx("jb-card", className)}>
      {title || eyebrow || action ? (
        <header className="jb-card__header">
          <div>
            {eyebrow ? <p className="jb-card__eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className="jb-card__title">{title}</h2> : null}
          </div>
          {action ? <div className="jb-card__action">{action}</div> : null}
        </header>
      ) : null}
      <div className="jb-card__body">{children}</div>
    </section>
  );
}
