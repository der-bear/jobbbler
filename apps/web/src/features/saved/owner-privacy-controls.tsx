"use client";

import { useState } from "react";

import {
  completeOwnerDeletionResultSchema,
  createOwnerDeletionIntentResultSchema,
  ownerSessionResultSchema,
  startOwnerRecoveryResultSchema,
  type OwnerSummary,
} from "@jobbbler/contracts";

import { ApiClientError, queryApi } from "@/lib/query-client";

import styles from "./owner-privacy-controls.module.css";

interface OwnerPrivacyControlsProps {
  readonly owner: OwnerSummary | null;
  readonly onRecovered: (owner: OwnerSummary) => void;
  readonly onDeleted: () => void;
}

function safeMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "This private-data request could not be completed. Try again.";
}

export function OwnerPrivacyControls({ owner, onRecovered, onDeleted }: OwnerPrivacyControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null);
  const [deletionPhrase, setDeletionPhrase] = useState("");
  const [deletionId, setDeletionId] = useState<string | null>(null);
  const [finalPhrase, setFinalPhrase] = useState("");

  async function startRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const started = await queryApi(
        "/api/v1/owners/recovery/start",
        startOwnerRecoveryResultSchema,
        { method: "POST", body: { email } },
      );
      setRecoveryId(started.recoveryId);
      setRecoveryHint(
        started.developmentCode === undefined
          ? "If a verified workspace matches, a six-digit code is on its way."
          : `Local capture code: ${started.developmentCode}`,
      );
      if (started.developmentCode !== undefined) setRecoveryCode(started.developmentCode);
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function completeRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recoveryId === null) return;
    setBusy(true);
    setError(null);
    try {
      const recovered = await queryApi(
        "/api/v1/owners/recovery/complete",
        ownerSessionResultSchema,
        { method: "POST", body: { recoveryId, code: recoveryCode } },
      );
      onRecovered(recovered.owner);
      setRecoveryId(null);
      setRecoveryCode("");
      setRecoveryHint(null);
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function startDeletion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const intent = await queryApi(
        "/api/v1/owners/deletion",
        createOwnerDeletionIntentResultSchema,
        { method: "POST", body: { confirmation: deletionPhrase } },
      );
      setDeletionId(intent.deletionId);
      setFinalPhrase("");
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function completeDeletion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deletionId === null) return;
    setBusy(true);
    setError(null);
    try {
      await queryApi("/api/v1/owners/deletion/complete", completeOwnerDeletionResultSchema, {
        method: "POST",
        body: { deletionId, confirmation: finalPhrase },
      });
      onDeleted();
    } catch (caught) {
      setError(safeMessage(caught));
      setBusy(false);
    }
  }

  if (owner === null) {
    return (
      <details className={styles["panel"]}>
        <summary className={styles["summary"]}>
          <span>Private access</span>
          <strong>Recover workspace</strong>
        </summary>
        <div className={styles["content"]}>
          <div>
            <span className={styles["label"]}>Private access</span>
            <h3>Recover a verified workspace</h3>
            <p>
              If a verified workspace matches this email, we send a short-lived code. The response
              never confirms whether an account exists.
            </p>
          </div>
          {recoveryId === null ? (
            <form className={styles["form"]} onSubmit={(event) => void startRecovery(event)}>
              <label>
                <span>Verified email</span>
                <input
                  autoComplete="email"
                  maxLength={320}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
              <button disabled={busy} type="submit">
                Send recovery code
              </button>
            </form>
          ) : (
            <form className={styles["form"]} onSubmit={(event) => void completeRecovery(event)}>
              <p className={styles["hint"]} role="status">
                {recoveryHint}
              </p>
              <label>
                <span>Six-digit code</span>
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/gu, ""))}
                  pattern="[0-9]{6}"
                  required
                  value={recoveryCode}
                />
              </label>
              <div className={styles["actions"]}>
                <button
                  className={styles["quiet"]}
                  disabled={busy}
                  onClick={() => setRecoveryId(null)}
                  type="button"
                >
                  Start over
                </button>
                <button disabled={busy || recoveryCode.length !== 6} type="submit">
                  Recover workspace
                </button>
              </div>
            </form>
          )}
          {error === null ? null : (
            <p className={styles["error"]} role="alert">
              {error}
            </p>
          )}
        </div>
      </details>
    );
  }

  return (
    <details className={`${styles["panel"]} ${styles["danger"]}`}>
      <summary className={styles["summary"]}>
        <span>Workspace controls</span>
        <strong>Privacy &amp; access</strong>
      </summary>
      <div className={styles["content"]}>
        <div>
          <span className={styles["label"]}>Privacy control</span>
          <h3>Delete private data</h3>
          <p>
            Permanently removes this workspace, its saved searches, alerts, applications,
            permissions, delivery destinations, and every active session. Public job listings
            remain.
          </p>
        </div>
        {deletionId === null ? (
          <form className={styles["form"]} onSubmit={(event) => void startDeletion(event)}>
          <label>
            <span>
              Type <strong>DELETE MY PRIVATE DATA</strong>
            </span>
            <input
              autoComplete="off"
              onChange={(event) => setDeletionPhrase(event.target.value)}
              required
              value={deletionPhrase}
            />
          </label>
          <button disabled={busy || deletionPhrase !== "DELETE MY PRIVATE DATA"} type="submit">
            Continue to final confirmation
          </button>
        </form>
      ) : (
        <form className={styles["form"]} onSubmit={(event) => void completeDeletion(event)}>
          <p className={styles["warning"]} role="alert">
            Final step. This cannot be undone. Type <strong>DELETE</strong> to remove the workspace
            now.
          </p>
          <label>
            <span>Final confirmation</span>
            <input
              autoComplete="off"
              onChange={(event) => setFinalPhrase(event.target.value)}
              required
              value={finalPhrase}
            />
          </label>
          <div className={styles["actions"]}>
            <button
              className={styles["quiet"]}
              disabled={busy}
              onClick={() => setDeletionId(null)}
              type="button"
            >
              Cancel
            </button>
            <button disabled={busy || finalPhrase !== "DELETE"} type="submit">
              Delete all private data
            </button>
          </div>
          </form>
        )}
        {error === null ? null : (
          <p className={styles["error"]} role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
