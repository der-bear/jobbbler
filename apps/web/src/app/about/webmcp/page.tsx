import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CompassIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/dist/ssr";

import styles from "./page.module.css";

export default function WebMcpAboutPage() {
  return (
    <article className={styles["page"]}>
      <header className={styles["hero"]}>
        <p className={styles["eyebrow"]}>About WebMCP</p>
        <h1>WebMCP helps inspect job sources. It does not decide for you.</h1>
        <p>
          In Jobbbler, WebMCP is the agent-facing layer that can request the same structured job
          discovery tools used by the app. It helps turn a clear search request into source-backed
          results.
        </p>
      </header>

      <section aria-labelledby="how-it-works" className={styles["section"]}>
        <div>
          <p className={styles["eyebrow"]}>How it works</p>
          <h2 id="how-it-works">A narrow bridge between a request and verifiable records.</h2>
        </div>
        <ol className={styles["steps"]}>
          <li>
            <CompassIcon aria-hidden="true" size={20} />
            <div>
              <strong>Search with constraints</strong>
              <p>
                It can express filters such as role, work model, location, skills, salary, and
                recency.
              </p>
            </div>
          </li>
          <li>
            <CheckCircleIcon aria-hidden="true" size={20} weight="fill" />
            <div>
              <strong>Return structured evidence</strong>
              <p>
                Jobbbler returns normalized records, fit evidence, caveats, exclusions, and source
                freshness.
              </p>
            </div>
          </li>
          <li>
            <ArrowSquareOutIcon aria-hidden="true" size={20} />
            <div>
              <strong>Keep the original source in view</strong>
              <p>
                Every role links back to its observed source when one is available, so you can
                verify it yourself.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section aria-labelledby="what-it-does-not-do" className={styles["section"]}>
        <div>
          <p className={styles["eyebrow"]}>Limits</p>
          <h2 id="what-it-does-not-do">What WebMCP does not do</h2>
        </div>
        <div className={styles["limits"]}>
          <p>
            It does not guarantee that a role is still open, that compensation is complete, or that
            a source is correct.
          </p>
          <p>
            It does not infer undisclosed salary, invent missing requirements, submit applications,
            or share account secrets.
          </p>
          <p>
            Fit scores are explanations of the active criteria, not hiring predictions or
            recommendations.
          </p>
        </div>
      </section>

      <section aria-labelledby="safe-use" className={styles["section"]}>
        <div>
          <p className={styles["eyebrow"]}>Safe use</p>
          <h2 id="safe-use">Treat it as research, not an authority.</h2>
        </div>
        <p className={styles["safeUse"]}>
          <ShieldCheckIcon aria-hidden="true" size={20} />
          Review evidence and unknowns, then follow the original listing before you act. Jobbbler
          only shows the data available in its observed record and leaves the final judgement to
          you.
        </p>
      </section>
    </article>
  );
}
