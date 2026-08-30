import {
  CheckCircleIcon,
  ClockCountdownIcon,
  EyeIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

import styles from "./page.module.css";

import { AgentExamplePrompt } from "@/components/agent-example-prompt";

export const metadata: Metadata = {
  title: "How Jobbbler works with your agent",
  description:
    "Search, compare, monitor, and prepare applications with a browser agent while you keep control of personal data and submission.",
};

const outcomeSteps = [
  {
    title: "Search",
    copy: "The agent turns what you ask for into filters you can see and change.",
  },
  {
    title: "Compare",
    copy: "It checks the facts and explains which roles fit best.",
  },
  {
    title: "Monitor",
    copy: "Save the search once. Jobbbler keeps checking and reports only what changed.",
  },
  {
    title: "Apply",
    copy: "For supported roles, it prepares the application. For others, it opens the employer's application page when one is available.",
  },
] as const;

const agentCan = [
  "Find and compare matching roles",
  "Check saved searches for changes",
  "Prepare application answers from facts you provide",
  "Open the employer's application page when Jobbbler cannot submit directly",
] as const;

const decisionsForYou = [
  "Facts only you can provide",
  "Whether the agent may prepare this application",
  "Consent to process your personal data for this application",
  "The exact final decision to submit",
  "The right to withdraw consent at any time",
] as const;

export default function WebMcpAboutPage() {
  return (
    <article className={styles["page"]}>
      <header className={styles["hero"]}>
        <p className={styles["eyebrow"]}>How Jobbbler works</p>
        <h1>Search once. Let your agent handle the repetition.</h1>
        <p>
          Job search repeats itself. Tell a compatible browser agent what kind of technology role
          you want. It can search, compare, keep checking, and prepare an application—while you
          decide when your personal data may be used and whether anything is submitted. The
          conversation stays in your agent app. No separate MCP server is needed.
        </p>
      </header>

      <section aria-labelledby="one-request" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>01</p>
          <h2 id="one-request">One conversation, from search to application</h2>
        </div>
        <div>
          <p className={styles["promptLabel"]}>Example request</p>
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

      <section aria-labelledby="control" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>02</p>
          <h2 id="control">You stay in control</h2>
        </div>
        <div className={styles["controlGrid"]}>
          <div>
            <h3>The agent handles</h3>
            <ul>
              {agentCan.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Stays with you</h3>
            <ul>
              {decisionsForYou.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <p className={styles["controlNote"]}>
            <ShieldCheckIcon aria-hidden="true" size={18} />
            Opening the site gives an agent no access to your private data. Decisions are made in
            your agent app and tied to the exact request.
          </p>
        </div>
      </section>

      <section aria-labelledby="built-in" className={styles["section"]}>
        <div className={styles["sectionHeading"]}>
          <p>03</p>
          <h2 id="built-in">Built into the site</h2>
        </div>
        <div className={styles["builtIn"]}>
          <p className={styles["lead"]}>
            When a compatible browser agent opens Jobbbler, it automatically finds the actions it
            can use. The same searches and safety rules power the agent and the job portal you see.
          </p>
          <div className={styles["proof"]}>
            <EyeIcon aria-hidden="true" size={21} />
            <div>
              <strong>See what happened.</strong>
              <p>
                Open Agent view to see the action, its status, and the result. The rest of Jobbbler
                stays a familiar job portal.
              </p>
            </div>
          </div>
          <div className={styles["statement"]}>
            <ClockCountdownIcon aria-hidden="true" size={21} />
            <p>
              Jobbbler keeps checking after the tab closes. Your agent can return with new, changed,
              closed, or no-longer-matching roles without repeating the whole search.
            </p>
          </div>
          <p className={styles["accountNote"]}>
            No account is needed to search. Email is verified only when you ask Jobbbler to keep
            checking for you.
          </p>
        </div>
      </section>

      <footer className={styles["footer"]}>
        <p>
          Start with a search. If you use a compatible browser agent, it can take on the repetitive
          steps whenever you ask.
        </p>
      </footer>
    </article>
  );
}
