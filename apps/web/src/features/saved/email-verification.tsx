"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  completeEmailVerificationResultSchema,
  startEmailVerificationResultSchema,
  type OwnerSummary,
} from "@jobbbler/contracts";

import { queryApi } from "@/lib/query-client";

export type EmailVerificationIntent = "updates" | "device-access";

interface EmailVerificationClassNames {
  readonly actions?: string | undefined;
  readonly error?: string | undefined;
  readonly form?: string | undefined;
  readonly hint?: string | undefined;
  readonly quietButton?: string | undefined;
  readonly submitButton?: string | undefined;
}

interface EmailVerificationProps {
  readonly classNames: EmailVerificationClassNames;
  readonly disabled?: boolean;
  readonly intent: EmailVerificationIntent;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onVerified: (owner: OwnerSummary) => void | Promise<void>;
  readonly sendIcon?: ReactNode;
  readonly toErrorMessage: (error: unknown) => string;
  readonly verifyIcon?: ReactNode;
}

export function emailVerificationCopy(intent: EmailVerificationIntent): Readonly<{
  emailLabel: string;
  verifyLabel: string;
}> {
  return intent === "updates"
    ? { emailLabel: "Your email", verifyLabel: "Verify and continue" }
    : { emailLabel: "Email to get back in", verifyLabel: "Verify" };
}

export function EmailVerification({
  classNames,
  disabled = false,
  intent,
  onBusyChange,
  onVerified,
  sendIcon,
  toErrorMessage,
  verifyIcon,
}: EmailVerificationProps) {
  const copy = emailVerificationCopy(intent);
  const [busy, setBusy] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (challengeId === null) return;
    const frame = window.requestAnimationFrame(() => codeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [challengeId]);

  function setWorking(nextBusy: boolean) {
    setBusy(nextBusy);
    onBusyChange?.(nextBusy);
  }

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const started = await queryApi(
        "/api/v1/owners/email/start",
        startEmailVerificationResultSchema,
        { method: "POST", body: { email } },
      );
      setChallengeId(started.challengeId);
      setHint(
        started.developmentCode === undefined
          ? `Code sent to ${started.maskedDestination}.`
          : `Local capture code: ${started.developmentCode}`,
      );
      if (started.developmentCode !== undefined) setCode(started.developmentCode);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  async function complete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (challengeId === null) return;
    setWorking(true);
    setError(null);
    try {
      const completed = await queryApi(
        "/api/v1/owners/email/complete",
        completeEmailVerificationResultSchema,
        { method: "POST", body: { challengeId, code } },
      );
      await onVerified(completed.owner);
      setChallengeId(null);
      setCode("");
      setHint(null);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  function startOver() {
    setChallengeId(null);
    setCode("");
    setError(null);
    setHint(null);
    window.requestAnimationFrame(() => emailRef.current?.focus());
  }

  const unavailable = busy || disabled;

  return (
    <>
      {challengeId === null ? (
        <form className={classNames.form} onSubmit={(event) => void start(event)}>
          <label>
            <span>{copy.emailLabel}</span>
            <input
              autoComplete="email"
              maxLength={320}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              ref={emailRef}
              required
              type="email"
              value={email}
            />
          </label>
          <button className={classNames.submitButton} disabled={unavailable} type="submit">
            Send code
            {sendIcon}
          </button>
        </form>
      ) : (
        <form className={classNames.form} onSubmit={(event) => void complete(event)}>
          {hint === null ? null : (
            <p aria-atomic="true" className={classNames.hint} role="status">
              {hint}
            </p>
          )}
          <label>
            <span>Six-digit code</span>
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setCode(event.target.value.replace(/\D/gu, ""))}
              pattern="[0-9]{6}"
              ref={codeRef}
              required
              value={code}
            />
          </label>
          <div className={classNames.actions}>
            {intent === "device-access" ? (
              <button
                className={classNames.quietButton}
                disabled={unavailable}
                onClick={startOver}
                type="button"
              >
                Start over
              </button>
            ) : null}
            <button
              className={classNames.submitButton}
              disabled={unavailable || code.length !== 6}
              type="submit"
            >
              {copy.verifyLabel}
              {verifyIcon}
            </button>
          </div>
        </form>
      )}
      {error === null ? null : (
        <p className={classNames.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
