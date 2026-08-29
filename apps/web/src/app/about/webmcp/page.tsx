import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  CompassIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/dist/ssr";

import styles from "./page.module.css";

export default function WebMcpAboutPage() {
  return (
    <article className={styles["page"]}>
      <header className={styles["hero"]}>
        <p className={styles["eyebrow"]}>One example of the agentic web</p>
        <h1>A job portal your browser agent can understand.</h1>
        <p>
          Jobbbler shows what changes when a familiar website exposes useful, structured actions
          directly to a compatible browser agent. Open the site from your agent client. No separate
          MCP server to install, declare, or configure.
        </p>
      </header>

      <section aria-labelledby="how-it-works" className={styles["section"]}>
        <div>
          <p className={styles["eyebrow"]}>How it works</p>
          <h2 id="how-it-works">Ask once. Let the site explain what it can do.</h2>
        </div>
        <ol className={styles["steps"]}>
          <li>
            <CompassIcon aria-hidden="true" size={20} />
            <div>
              <strong>Describe the outcome</strong>
              <p>
                The conversation stays in your agent client. You can ask for remote platform roles,
                compare a shortlist, monitor a search, or prepare an application.
              </p>
            </div>
          </li>
          <li>
            <CheckCircleIcon aria-hidden="true" size={20} weight="fill" />
            <div>
              <strong>Open Jobbbler</strong>
              <p>
                A compatible browser agent discovers the actions available on that page and uses
                typed inputs instead of guessing where to click.
              </p>
            </div>
          </li>
          <li>
            <ArrowSquareOutIcon aria-hidden="true" size={20} />
            <div>
              <strong>See the same result</strong>
              <p>
                The URL, filters, results, saved alert, or application state updates through the
                same server rules as the visible interface.
              </p>
            </div>
          </li>
          <li>
            <ShieldCheckIcon aria-hidden="true" size={20} />
            <div>
              <strong>Keep consequential choices explicit</strong>
              <p>
                Data sharing and submission use exact, review-bound requests. An agent-mediated
                approval is stored as evidence of the action without claiming cryptographic human
                or agent identity.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section aria-labelledby="why-jobs" className={styles["section"]}>
        <div>
          <p className={styles["eyebrow"]}>Why jobs</p>
          <h2 id="why-jobs">Useful work is repetitive. Decisions should not be.</h2>
        </div>
        <div className={styles["limits"]}>
          <p>
            Job markets change every day. People repeatedly scan new listings, rebuild the same
            filters, compare incomplete evidence, and track what changed.
          </p>
          <p>
            WebMCP makes the live website directly operable by an agent while keeping every role,
            source, unknown, and decision understandable to a person.
          </p>
          <p>
            This is one proof case for a broader pattern: any data-rich platform can offer a
            focused agent interface alongside its familiar human interface.
          </p>
        </div>
      </section>

      <section aria-labelledby="live-and-durable" className={styles["section"]}>
        <div>
          <p className={styles["eyebrow"]}>Live and durable work</p>
          <h2 id="live-and-durable">The browser starts the task. The service keeps its promises.</h2>
        </div>
        <p className={styles["safeUse"]}>
          <ClockCountdownIcon aria-hidden="true" size={20} />
          WebMCP actions are available while the agent has the page open. If you save a monitored
          search, alerts keep running through Jobbbler after the tab closes and report only newly
          observed matching roles.
        </p>
      </section>

      <section aria-labelledby="limits" className={styles["section"]}>
        <div>
          <p className={styles["eyebrow"]}>Clear limits</p>
          <h2 id="limits">Assistance is not authority.</h2>
        </div>
        <div className={styles["limits"]}>
          <p>
            WebMCP does not guarantee that a role is still open, compensation is complete, or a
            source is correct.
          </p>
          <p>
            Jobbbler does not invent missing requirements, expose account secrets, or let tool
            discovery bypass server authorization.
          </p>
          <p>
            Fit explanations describe the active criteria. They are not hiring predictions, and
            every observed role keeps its source and known unknowns in view.
          </p>
        </div>
      </section>
    </article>
  );
}
