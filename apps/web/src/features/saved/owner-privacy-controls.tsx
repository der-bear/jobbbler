"use client";

import { CaretDownIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import {
  completeOwnerDeletionResultSchema,
  createOwnerDeletionIntentResultSchema,
  ownerSessionResultSchema,
  startOwnerRecoveryResultSchema,
  type OwnerSummary,
} from "@jobbbler/contracts";

import { ApiClientError, queryApi } from "@/lib/query-client";
import { clearOwnerSessionMarker, markOwnerSessionStarted } from "@/lib/owner-session-marker";

import { EmailVerification } from "./email-verification";
import styles from "./owner-privacy-controls.module.css";

interface OwnerPrivacyControlsProps {
  readonly hasVerifiedRecoveryEmail: boolean;
  readonly owner: OwnerSummary | null;
  readonly onRecovered: (owner: OwnerSummary) => void;
  readonly onRecoveryEmailEnabled: (owner: OwnerSummary) => void;
  readonly onDeleted: () => void;
}

function safeMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "This private-data request could not be completed. Try again.";
}

export function OwnerPrivacyControls({
  hasVerifiedRecoveryEmail,
  owner,
  onRecovered,
  onRecoveryEmailEnabled,
  onDeleted,
}: OwnerPrivacyControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null);
  const recoveryCodeRef = useRef<HTMLInputElement | null>(null);
  const [deletionPhrase, setDeletionPhrase] = useState("");
  const [deletionId, setDeletionId] = useState<string | null>(null);
  const [finalPhrase, setFinalPhrase] = useState("");
  const finalPhraseRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (recoveryId === null) return;
    const frame = window.requestAnimationFrame(() => recoveryCodeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [recoveryId]);

  useEffect(() => {
    if (deletionId === null) return;
    const frame = window.requestAnimationFrame(() => finalPhraseRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [deletionId]);

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
          ? "If that email was used before, a six-digit code is on its way."
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
      markOwnerSessionStarted(recovered.expiresAt);
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
      clearOwnerSessionMarker();
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
          <span>Been here before?</span>
          <strong>Restore with email</strong>
          <CaretDownIcon aria-hidden="true" className={styles["summaryIcon"]} size={16} />
        </summary>
        <div className={styles["content"]}>
          <div>
            <h2>Restore your Jobbbler work</h2>
            <p>Enter the email you verified before. We’ll send a six-digit code.</p>
          </div>
          {recoveryId === null ? (
            <form className={styles["form"]} onSubmit={(event) => void startRecovery(event)}>
              <label>
                <span>Email you used before</span>
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
                Send code
              </button>
            </form>
          ) : (
            <form className={styles["form"]} onSubmit={(event) => void completeRecovery(event)}>
              <p aria-atomic="true" className={styles["hint"]} role="status">
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
                  ref={recoveryCodeRef}
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
                  Restore
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
    <>
      {hasVerifiedRecoveryEmail ? null : (
        <details className={styles["panel"]}>
          <summary className={styles["summary"]}>
            <span>Optional</span>
            <strong>Get back in from another device</strong>
            <CaretDownIcon aria-hidden="true" className={styles["summaryIcon"]} size={16} />
          </summary>
          <div className={styles["content"]}>
            <div>
              <h2>Add your email</h2>
              <p>
                Verify it once. It brings back your saved searches and applications on another
                device. This does not turn on email updates.
              </p>
            </div>
            <EmailVerification
              classNames={{
                actions: styles["actions"],
                error: styles["error"],
                form: styles["form"],
                hint: styles["hint"],
                quietButton: styles["quiet"],
              }}
              disabled={busy}
              intent="device-access"
              onBusyChange={setBusy}
              onVerified={onRecoveryEmailEnabled}
              toErrorMessage={safeMessage}
            />
          </div>
        </details>
      )}
      <details className={`${styles["panel"]} ${styles["danger"]}`}>
        <summary className={styles["summary"]}>
          <span>Your data</span>
          <strong>Delete private data</strong>
          <CaretDownIcon aria-hidden="true" className={styles["summaryIcon"]} size={16} />
        </summary>
        <div className={styles["content"]}>
          <div>
            <span className={styles["label"]}>Privacy control</span>
            <h2>Delete private data</h2>
            <p>
              Permanently removes everything you saved here: searches, email updates, applications,
              permissions, and verified emails. Public job listings remain.
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
              <p aria-atomic="true" className={styles["warning"]} role="alert">
                Final step. This cannot be undone. Type <strong>DELETE</strong> to remove everything
                now.
              </p>
              <label>
                <span>Final confirmation</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setFinalPhrase(event.target.value)}
                  ref={finalPhraseRef}
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
    </>
  );
}
