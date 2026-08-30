import {
  CheckCircleIcon,
  ClockCountdownIcon,
  EyeIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/dist/ssr";

import styles from "./page.module.css";

import { AgentExamplePrompt } from "@/components/agent-example-prompt";

const outcomeSteps = [
  {
    title: "Search",
    copy: "The agent turns the request into visible, editable filters and source-backed results.",
  },
  {
    title: "Compare",
    copy: "It reads the facts and places the strongest roles side by side without losing evidence.",
  },
  {
    title: "Monitor",
    copy: "You save the exact search so Jobbbler can report only what changes later.",
  },
  {
    title: "Apply",
    copy: "After a capability check, it prepares one managed internal role. External roles continue on the validated employer page only when available. If no validated page is available, it stops.",
  },
] as const;

const agentCan = [
  "Search, filter, inspect, and compare roles",
  "Return new or changed results from a saved search",
  "Prepare one application for a managed internal role",
  "Continue to an available validated employer page for an external role; otherwise stop",
] as const;

const onlyYouCan = [
  "Approve what an agent may change",
  "Choose what candidate data is shared and why",
  "Confirm the exact final application",
  "Withdraw candidate-data consent at any time",
] as const;

export default function WebMcpAboutPage() {
  return (
    <article className={styles["page"]}>
      <header className={styles["hero"]}>
        <p className={styles["eyebrow"]}>How Jobbbler works with agents</p>
        <h1>Ask for an outcome. Jobbbler handles the website.</h1>
        <p>
          The conversation stays in your agent client. Jobbbler is the familiar job portal
          underneath, with structured actions a browser agent can discover automatically. No
          separate MCP server to install or configure.
        </p>
      </header>

      <section aria-labelledby="one-request" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>01</p>
          <h2 id="one-request">One request, a complete workflow</h2>
        </div>
        <div>
          <AgentExamplePrompt
            className={styles["promptBlock"]}
            promptClassName={styles["prompt"]}
          />
          <ol className={styles["steps"]}>
            {outcomeSteps.map((step) => (
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

      <section aria-labelledby="built-in" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>02</p>
          <h2 id="built-in">Built into the site</h2>
        </div>
        <div className={styles["builtIn"]}>
          <p className={styles["lead"]}>
            WebMCP gives the visited website a direct agent interface. The same search, ownership,
            validation, and safety rules serve both the visible UI and its tools.
          </p>
          <div className={styles["proof"]}>
            <EyeIcon aria-hidden="true" size={21} />
            <div>
              <strong>Proof you can see</strong>
              <p>
                Open Agent view to see the tools the browser discovered and the result of each call.
                It keeps the technical proof visible without changing the job portal.
              </p>
            </div>
          </div>
          <div className={styles["statement"]}>
            <ClockCountdownIcon aria-hidden="true" size={21} />
            <p>
              Jobbbler keeps checking after the tab closes. The agent can return to new, updated,
              closed, or no-longer-matching roles without repeating the whole search.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="control" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>03</p>
          <h2 id="control">You approve the important parts</h2>
        </div>
        <div className={styles["controlGrid"]}>
          <div>
            <h3>Agent can</h3>
            <ul>
              {agentCan.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Only you can</h3>
            <ul>
              {onlyYouCan.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <p className={styles["controlNote"]}>
            <ShieldCheckIcon aria-hidden="true" size={18} />
            Tool discovery is not treated as identity or permission. Every private action is
            rechecked by Jobbbler.
          </p>
        </div>
      </section>

      <footer className={styles["footer"]}>
        <p>
          Jobs are the proof case. The same pattern can make any data-rich website directly useful
          to agents while keeping its human interface familiar.
        </p>
      </footer>
    </article>
  );
}
