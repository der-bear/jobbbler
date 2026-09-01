import { ArrowRightIcon, CheckCircleIcon, ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How Jobbbler handles private workspaces, optional email updates, recovery, and application consent.",
};

const emailChoices = [
  "Saving a search never requires an email.",
  "Email updates are optional and use only the schedule and destination you approve.",
  "Access on another device is optional and uses your email plus a one-time code.",
] as const;

const applicationChoices = [
  "An agent gets short-lived permission for one application, not your whole workspace.",
  "Before submission, you see the recipient and every field that will be shared.",
  "Your final decision applies only to that unchanged application.",
] as const;

export default function PrivacyPage() {
  return (
    <article className={styles["page"]}>
      <header className={styles["hero"]}>
        <p className={styles["eyebrow"]}>Privacy</p>
        <h1>Privacy, without the fine-print maze.</h1>
        <p>
          Jobbbler keeps searches simple and asks only when a feature needs personal data. An email
          is optional. Application data stays tied to one application. Preparing and submitting it
          each require a clear decision.
        </p>
      </header>

      <section aria-labelledby="workspace-privacy" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>01</p>
          <h2 id="workspace-privacy">A private workspace, no account</h2>
        </div>
        <div className={styles["sectionBody"]}>
          <p>
            Jobbbler creates a private workspace for saved searches and applications. This browser
            keeps access to it. You can search and apply without creating a password.
          </p>
          <div className={styles["notice"]}>
            <ShieldCheckIcon aria-hidden="true" size={20} weight="fill" />
            <p>
              Jobbbler does not treat email verification as consent. A one-time code proves access
              to the inbox; every data-use or submission decision remains separate.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="email-privacy" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>02</p>
          <h2 id="email-privacy">Email only when you ask</h2>
        </div>
        <ul className={styles["choiceList"]}>
          {emailChoices.map((choice) => (
            <li key={choice}>
              <CheckCircleIcon aria-hidden="true" size={18} weight="fill" />
              <span>{choice}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="application-privacy" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>03</p>
          <h2 id="application-privacy">One application, one clear decision</h2>
        </div>
        <div className={styles["sectionBody"]}>
          <ul className={styles["choiceList"]}>
            {applicationChoices.map((choice) => (
              <li key={choice}>
                <CheckCircleIcon aria-hidden="true" size={18} weight="fill" />
                <span>{choice}</span>
              </li>
            ))}
          </ul>
          <p className={styles["plainNote"]}>
            Your CV stays with you and your agent; Jobbbler receives only the completed answers
            needed for the application. You can withdraw consent for future processing. That does
            not erase or retract an application already submitted.
          </p>
        </div>
      </section>

      <section aria-labelledby="privacy-controls" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>04</p>
          <h2 id="privacy-controls">Your controls stay close</h2>
        </div>
        <div className={styles["actions"]}>
          <Link href="/saved">
            <span>
              <strong>Saved searches</strong>
              <small>Manage email updates, recovery, and saved criteria.</small>
            </span>
            <ArrowRightIcon aria-hidden="true" size={17} />
          </Link>
          <Link href="/applications">
            <span>
              <strong>My applications</strong>
              <small>See progress and the receipt for anything submitted.</small>
            </span>
            <ArrowRightIcon aria-hidden="true" size={17} />
          </Link>
        </div>
      </section>
    </article>
  );
}
