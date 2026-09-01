import Link from "next/link";

import styles from "./status.module.css";

export default function NotFound() {
  return (
    <section className={styles["state"]}>
      <h1>This page isn’t here.</h1>
      <p className={styles["detail"]}>
        The address may have a typo in it, or the page may have been a role that has since closed.
        Nothing you saved has been affected.
      </p>
      <div className={styles["actions"]}>
        <Link className={styles["primary"]} href="/jobs">
          Browse open roles
        </Link>
        <Link className={styles["secondary"]} href="/applications">
          My applications
        </Link>
      </div>
    </section>
  );
}
