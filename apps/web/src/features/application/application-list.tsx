"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  applicationListSchema,
  type ApplicationListItem,
  type ApplicationState,
} from "@jobbbler/contracts";

import { ApiClientError, queryApi } from "@/lib/query-client";

import styles from "./application-list.module.css";

function stateLabel(state: ApplicationState): string {
  switch (state) {
    case "submitted":
      return "Submitted";
    case "handed_off":
      return "Employer site";
    case "withdrawn":
      return "Withdrawn";
    case "failed":
      return "Needs attention";
    case "submitting":
      return "Submitting";
    case "valid":
      return "Ready to review";
    case "reviewed":
    case "awaiting_confirmation":
      return "Your decision needed";
    case "draft":
      return "Draft";
    default:
      return "In progress";
  }
}

function actionLabel(state: ApplicationState): string {
  switch (state) {
    case "submitted":
      return "View receipt";
    case "handed_off":
      return "View details";
    case "valid":
    case "reviewed":
    case "awaiting_confirmation":
    case "failed":
      return "Review application";
    case "submitting":
      return "View status";
    case "draft":
      return "Open draft";
    default:
      return "View application";
  }
}

function updatedLabel(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

export function ApplicationHistory({ items }: Readonly<{ items: readonly ApplicationListItem[] }>) {
  return (
    <section aria-labelledby="applications-title" className={styles["page"]}>
      <header className={styles["header"]}>
        <h1 id="applications-title">Applications</h1>
        <p>Track drafts prepared for you and see what needs your decision.</p>
      </header>

      {items.length === 0 ? (
        <div className={styles["empty"]}>
          <h2>No applications yet</h2>
          <p>When your agent prepares an application, it will appear here.</p>
          <Link className={styles["primaryLink"]} href="/jobs">
            Browse jobs <ArrowRightIcon aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <ol className={styles["list"]}>
          {items.map((item) => (
            <li className={styles["row"]} key={item.draftId}>
              <div className={styles["role"]}>
                <h2>{item.job.title}</h2>
                <p>{item.job.organizationName}</p>
              </div>
              <div className={styles["state"]}>
                <span data-state={item.state}>{stateLabel(item.state)}</span>
                <time dateTime={item.updatedAt}>Updated {updatedLabel(item.updatedAt)}</time>
              </div>
              <Link className={styles["rowLink"]} href={`/apply/${item.draftId}`}>
                {actionLabel(item.state)} <ArrowRightIcon aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ApplicationsWorkspace({
  initialItems = null,
}: Readonly<{ initialItems?: readonly ApplicationListItem[] | null }>) {
  const [items, setItems] = useState<readonly ApplicationListItem[] | null>(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (initialItems !== null && attempt === 0) return;
    const controller = new AbortController();
    setError(null);
    void queryApi("/api/v1/applications", applicationListSchema, { signal: controller.signal })
      .then(setItems)
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof ApiClientError
            ? caught.message
            : "Applications could not be loaded. Please try again.",
        );
      });
    return () => controller.abort();
  }, [attempt, initialItems]);

  useEffect(() => {
    if (initialItems !== null) setItems(initialItems);
  }, [initialItems]);

  if (error !== null) {
    return (
      <section className={styles["page"]}>
        <header className={styles["header"]}>
          <h1>Applications</h1>
        </header>
        <div className={styles["empty"]} role="alert">
          <h2>Applications could not be loaded</h2>
          <p>{error}</p>
          <button className={styles["retry"]} onClick={retry} type="button">
            Try again
          </button>
        </div>
      </section>
    );
  }

  if (items === null) {
    return (
      <section aria-busy="true" className={styles["page"]}>
        <header className={styles["header"]}>
          <h1>Applications</h1>
          <p>Loading your applications…</p>
        </header>
        <div className={styles["loading"]} role="status">
          <span />
          <span />
          <span />
        </div>
      </section>
    );
  }

  return <ApplicationHistory items={items} />;
}
