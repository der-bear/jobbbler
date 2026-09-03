"use client";

import { ArrowRightIcon, FileTextIcon, TrashIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { applicationListSchema, type ApplicationListItem } from "@jobbbler/contracts";
import { z } from "zod";

import { OwnerPrivacyControls } from "@/features/saved/owner-privacy-controls";
import { titleWithoutEmploymentSuffix } from "@/lib/job-format";
import { ApiClientError, queryApi } from "@/lib/query-client";
import { hasOwnerSessionMarker, markOwnerSessionStarted } from "@/lib/owner-session-marker";

import styles from "./application-list.module.css";

function closedNonterminal(item: ApplicationListItem): boolean {
  return (
    item.job.status !== "open" &&
    item.state !== "submitted" &&
    item.state !== "handed_off" &&
    item.state !== "withdrawn"
  );
}

/*
 * From where the person stands an application is either submitted or it is
 * not. The stages in between — validated, reviewed, waiting on a decision —
 * are the machine's business and belong on the application page, where the
 * next step is explained; here they only made the list read like a workflow.
 */
function stateLabel(item: ApplicationListItem): string {
  if (closedNonterminal(item)) return "Role closed";
  const { state } = item;
  switch (state) {
    case "submitted":
      return "Submitted";
    case "handed_off":
      return "Finish on the employer website";
    case "withdrawn":
      return "Withdrawn";
    case "failed":
      return "Something went wrong";
    case "submitting":
      return "Submitting";
    default:
      return "Not submitted";
  }
}

function actionLabel(item: ApplicationListItem): string {
  if (closedNonterminal(item)) return "View application";
  const { state } = item;
  switch (state) {
    case "submitted":
      return "View receipt";
    case "handed_off":
      return "View next step";
    case "submitting":
      return "View status";
    case "withdrawn":
      return "View application";
    default:
      return "Open application";
  }
}

/*
 * Formatted in UTC on purpose: this list renders on the server and again on
 * the client, and a zone-dependent day would differ between the two around
 * midnight and trip React's hydration check. The receipt uses the same rule.
 */
function updatedLabel(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(value),
  );
}

/*
 * Only work that was never sent can be removed. A submitted application keeps
 * its receipt, because that receipt is the evidence of what the person agreed
 * to disclose; withdrawing consent is the control that applies to those.
 */
function removable(item: ApplicationListItem): boolean {
  return item.state !== "submitted" && item.state !== "handed_off";
}

export function ApplicationHistory({
  items,
  recovery = null,
  onRemove,
  removing = null,
}: Readonly<{
  items: readonly ApplicationListItem[];
  recovery?: ReactNode;
  onRemove?: (draftId: string) => void;
  removing?: string | null;
}>) {
  return (
    <section aria-labelledby="applications-title" className={styles["page"]}>
      <header className={styles["header"]}>
        {/*
         * Title and sentence stack, as they do on /saved. The two pages are one
         * tab apart and this sentence used to sit beside the title here and
         * under it there, so it changed place when you switched between them.
         * /saved cannot move it — its right column holds the access card — so
         * this is the side that gives.
         */}
        <div>
          <h1 id="applications-title">My applications</h1>
          <p className={styles["lede"]}>
            Applications prepared or submitted through Jobbbler. Open one to see its current status
            and details.
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className={styles["empty"]}>
          <FileTextIcon aria-hidden="true" size={25} />
          <h2>No applications yet</h2>
          <p>
            Browse roles to apply yourself, or ask your agent to apply for you. It must ask before
            Jobbbler uses your personal data or sends an application.
          </p>
          <Link className={styles["primaryLink"]} href="/jobs">
            Browse open roles <ArrowRightIcon aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <ol className={styles["list"]}>
          {items.map((item) => (
            <li className={styles["row"]} key={item.draftId}>
              <div className={styles["role"]}>
                <h2>{titleWithoutEmploymentSuffix(item.job.title)}</h2>
                <p>{item.job.organizationName}</p>
              </div>
              <div className={styles["state"]}>
                <span data-state={item.state}>{stateLabel(item)}</span>
                <time dateTime={item.updatedAt}>Updated {updatedLabel(item.updatedAt)}</time>
              </div>
              <div className={styles["rowActions"]}>
                <Link className={styles["rowLink"]} href={`/apply/${item.draftId}`}>
                  {actionLabel(item)} <ArrowRightIcon aria-hidden="true" />
                </Link>
                {onRemove === undefined || !removable(item) ? null : (
                  <button
                    aria-label={`Remove the draft application to ${item.job.title}`}
                    className={styles["remove"]}
                    disabled={removing === item.draftId}
                    onClick={() => onRemove(item.draftId)}
                    type="button"
                  >
                    <TrashIcon aria-hidden="true" />
                    {removing === item.draftId ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/*
       * Getting back into a workspace belongs to the page, not to the empty
       * state. Nested inside that outlined pane, its hairline rule ran into the
       * pane's own edge and read as a seam; on /saved the same control already
       * sits at page level, so the two pages now agree.
       */}
      {recovery === null ? null : <div className={styles["recovery"]}>{recovery}</div>}
    </section>
  );
}

export function ApplicationsWorkspace({
  initialItems = null,
}: Readonly<{ initialItems?: readonly ApplicationListItem[] | null }>) {
  const [items, setItems] = useState<readonly ApplicationListItem[] | null>(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [recovered, setRecovered] = useState(initialItems !== null);

  const [removing, setRemoving] = useState<string | null>(null);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const remove = useCallback((draftId: string) => {
    setRemoving(draftId);
    setError(null);
    void queryApi(`/api/v1/applications/${draftId}`, z.looseObject({}), { method: "DELETE" })
      .then(() => setItems((current) => (current ?? []).filter((item) => item.draftId !== draftId)))
      .catch((caught: unknown) => {
        setError(
          caught instanceof ApiClientError
            ? caught.message
            : "The application could not be removed. Please try again.",
        );
      })
      .finally(() => setRemoving(null));
  }, []);
  const reloadAfterRecovery = useCallback(() => {
    setRecovered(true);
    retry();
  }, [retry]);

  useEffect(() => {
    if (initialItems !== null) markOwnerSessionStarted();
  }, [initialItems]);

  useEffect(() => {
    if (initialItems !== null && attempt === 0) return;
    /*
     * A visitor without a private workspace has no applications to list, so the
     * owner-scoped request waits for one instead of provoking an expected
     * authorization failure on a public page.
     */
    if (initialItems === null && attempt === 0 && !hasOwnerSessionMarker()) {
      setItems([]);
      return;
    }
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
    if (initialItems !== null) {
      setItems(initialItems);
      setRecovered(true);
    }
  }, [initialItems]);

  if (error !== null) {
    return (
      <section className={styles["page"]}>
        <header className={styles["header"]}>
          <h1>My applications</h1>
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

  const recovery =
    initialItems === null && !recovered ? (
      <OwnerPrivacyControls
        hasVerifiedRecoveryEmail={false}
        owner={null}
        onDeleted={() => undefined}
        onRecovered={reloadAfterRecovery}
        onRecoveryEmailEnabled={() => undefined}
      />
    ) : null;

  return (
    <ApplicationHistory
      items={items ?? []}
      onRemove={remove}
      recovery={recovery}
      removing={removing}
    />
  );
}
