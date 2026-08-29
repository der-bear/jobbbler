import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  EyeIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/dist/ssr";

import styles from "./page.module.css";

const steps = [
  {
    title: "Ask in your agent client",
    copy: "Describe the outcome in ordinary language: find remote platform roles, compare a shortlist, or watch a search.",
  },
  {
    title: "Open Jobbbler",
    copy: "A compatible browser agent discovers the site's structured actions and uses them without guessing where to click.",
  },
  {
    title: "See the result here",
    copy: "Searches, saved alerts, and application state use the same server rules as the visible website.",
  },
] as const;

export default function WebMcpAboutPage() {
  return (
    <article className={styles["page"]}>
      <header className={styles["hero"]}>
        <p className={styles["eyebrow"]}>How Jobbbler works with agents</p>
        <h1>Ask for an outcome. Let the site handle the steps.</h1>
        <p>
          Jobbbler is an ordinary job portal with a useful second interface for browser agents. No
          separate MCP server to install or configure.
        </p>
      </header>

      <section aria-labelledby="site-interface" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>01</p>
          <h2 id="site-interface">The site becomes the interface</h2>
        </div>
        <div>
          <p className={styles["lead"]}>
            The conversation stays in your agent client. Jobbbler simply gives that agent a clear,
            typed way to work with the live website.
          </p>
          <ol className={styles["steps"]}>
            {steps.map((step) => (
              <li key={step.title}>
                <CheckCircleIcon aria-hidden="true" size={18} weight="fill" />
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="proof" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>02</p>
          <h2 id="proof">Proof you can see</h2>
        </div>
        <div className={styles["proof"]}>
          <EyeIcon aria-hidden="true" size={22} />
          <div>
            <strong>Open Agent view</strong>
            <p>
              See which tools are available and which action just ran. It is a small technical
              window for this demonstration; the job-search experience stays simple.
            </p>
          </div>
          <ArrowRightIcon aria-hidden="true" className={styles["proofArrow"]} size={18} />
        </div>
      </section>

      <section aria-labelledby="durable" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>03</p>
          <h2 id="durable">Useful after the tab closes</h2>
        </div>
        <div className={styles["statement"]}>
          <ClockCountdownIcon aria-hidden="true" size={21} />
          <p>
            Save a search once. Jobbbler keeps checking after the tab closes, so an agent can later
            return only what changed: new, updated, closed, or no-longer-matching roles.
          </p>
        </div>
      </section>

      <section aria-labelledby="control" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>04</p>
          <h2 id="control">The person stays in control</h2>
        </div>
        <div className={styles["statement"]}>
          <ShieldCheckIcon aria-hidden="true" size={21} />
          <div>
            <p>
              An agent can prepare work and request the minimum access it needs. Sharing candidate
              data or submitting an application still requires a clear decision in the private
              application workspace.
            </p>
            <p className={styles["note"]}>
              Jobbbler records the exact reviewed data and decision without pretending that tool
              discovery proves a person's identity.
            </p>
          </div>
        </div>
      </section>

      <footer className={styles["footer"]}>
        <p>
          Jobs are one proof case. The same pattern can make any data-rich website directly useful
          to agents while keeping its human interface familiar.
        </p>
      </footer>
    </article>
  );
}
