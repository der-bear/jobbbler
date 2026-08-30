"use client";

import { useEffect, useRef, useState } from "react";

import {
  completeEmailVerificationResultSchema,
  completeOwnerDeletionResultSchema,
  createOwnerDeletionIntentResultSchema,
  ownerSessionResultSchema,
  startEmailVerificationResultSchema,
  startOwnerRecoveryResultSchema,
  type OwnerSummary,
} from "@jobbbler/contracts";

import { ApiClientError, queryApi } from "@/lib/query-client";
import { clearOwnerSessionMarker, markOwnerSessionStarted } from "@/lib/owner-session-marker";

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
  const [recoverySetupError, setRecoverySetupError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null);
  const recoveryCodeRef = useRef<HTMLInputElement | null>(null);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationHint, setVerificationHint] = useState<string | null>(null);
  const verificationCodeRef = useRef<HTMLInputElement | null>(null);
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
    if (verificationId === null) return;
    const frame = window.requestAnimationFrame(() => verificationCodeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [verificationId]);

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

  async function startRecoveryEmailVerification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setRecoverySetupError(null);
    try {
      const started = await queryApi(
        "/api/v1/owners/email/start",
        startEmailVerificationResultSchema,
        { method: "POST", body: { email } },
      );
      setVerificationId(started.challengeId);
      setVerificationHint(
        started.developmentCode === undefined
          ? `Code sent to ${started.maskedDestination}.`
          : `Local capture code: ${started.developmentCode}`,
      );
      if (started.developmentCode !== undefined) setVerificationCode(started.developmentCode);
    } catch (caught) {
      setRecoverySetupError(safeMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function completeRecoveryEmailVerification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verificationId === null) return;
    setBusy(true);
    setRecoverySetupError(null);
    try {
      const completed = await queryApi(
        "/api/v1/owners/email/complete",
        completeEmailVerificationResultSchema,
        { method: "POST", body: { challengeId: verificationId, code: verificationCode } },
      );
      onRecoveryEmailEnabled(completed.owner);
      setVerificationId(null);
      setVerificationCode("");
      setVerificationHint(null);
    } catch (caught) {
      setRecoverySetupError(safeMessage(caught));
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
        </summary>
        <div className={styles["content"]}>
          <div>
            <h2>Restore your Jobbbler work</h2>
            <p>Enter the email you verified before. We’ll send a six-digit code.</p>
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
            <strong>Keep access on other devices</strong>
          </summary>
          <div className={styles["content"]}>
            <div>
              <h2>Add a recovery email</h2>
              <p>
                Verify once to restore saved searches and applications if this browser loses access.
                This does not turn on email updates.
              </p>
            </div>
            {verificationId === null ? (
              <form
                className={styles["form"]}
                onSubmit={(event) => void startRecoveryEmailVerification(event)}
              >
                <label>
                  <span>Email address</span>
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
                  Send verification code
                </button>
              </form>
            ) : (
              <form
                className={styles["form"]}
                onSubmit={(event) => void completeRecoveryEmailVerification(event)}
              >
                <p aria-atomic="true" className={styles["hint"]} role="status">
                  {verificationHint}
                </p>
                <label>
                  <span>Six-digit code</span>
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setVerificationCode(event.target.value.replace(/\D/gu, ""))
                    }
                    pattern="[0-9]{6}"
                    ref={verificationCodeRef}
                    required
                    value={verificationCode}
                  />
                </label>
                <div className={styles["actions"]}>
                  <button
                    className={styles["quiet"]}
                    disabled={busy}
                    onClick={() => setVerificationId(null)}
                    type="button"
                  >
                    Start over
                  </button>
                  <button disabled={busy || verificationCode.length !== 6} type="submit">
                    Verify email
                  </button>
                </div>
              </form>
            )}
            {recoverySetupError === null ? null : (
              <p className={styles["error"]} role="alert">
                {recoverySetupError}
              </p>
            )}
          </div>
        </details>
      )}
      <details className={`${styles["panel"]} ${styles["danger"]}`}>
        <summary className={styles["summary"]}>
          <span>Workspace controls</span>
          <strong>Privacy &amp; access</strong>
        </summary>
        <div className={styles["content"]}>
          <div>
            <span className={styles["label"]}>Privacy control</span>
            <h2>Delete private data</h2>
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
              <p aria-atomic="true" className={styles["warning"]} role="alert">
                Final step. This cannot be undone. Type <strong>DELETE</strong> to remove the
                workspace now.
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
