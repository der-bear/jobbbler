"use client";

import Link from "next/link";

import styles from "./status.module.css";

/*
 * The last net under the app. Without it a failed render hands the visitor
 * Next.js's own error screen, which says nothing about their application and
 * offers no way back into the product.
 *
 * The thrown message is deliberately not shown: it is written for a log, not
 * for a person, and it can carry internals. The digest is enough to match a
 * report against one.
 */
export default function AppError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <section className={styles["state"]}>
      <h1>Something went wrong on our side.</h1>
      <p className={styles["detail"]}>
        This is not something you did. Nothing you had saved was lost — try loading the page again,
        and if it keeps happening, your applications are still where you left them.
      </p>
      <div className={styles["actions"]}>
        <button className={styles["primary"]} onClick={reset} type="button">
          Try again
        </button>
        <Link className={styles["secondary"]} href="/applications">
          My applications
        </Link>
      </div>
      {error.digest === undefined ? null : (
        <p className={styles["reference"]}>Reference {error.digest}</p>
      )}
    </section>
  );
}
