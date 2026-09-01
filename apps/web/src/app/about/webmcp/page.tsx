import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  EyeIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";

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
    copy: "The agent prepares one application and waits. Nothing is sent until you say yes.",
  },
] as const;

const agentCan = [
  "Find and compare matching roles",
  "Check saved searches for changes",
  "Optionally add an email so applications and saved searches can be recovered",
  "Restore applications and saved searches with the email and one-time code you provide",
  "Prepare application answers from facts you provide",
  "Relay your explicit final yes or no to Jobbbler",
] as const;

const decisionsForYou = [
  "Facts only you can provide",
  "Whether the agent may prepare this application",
  "The exact application, recipient, and data shown before your final decision",
  "The final yes or no that records consent and controls submission",
  "The right to withdraw consent for future processing",
] as const;

export default function WebMcpAboutPage() {
  return (
    <article className={styles["page"]}>
      <header className={styles["hero"]}>
        <p className={styles["eyebrow"]}>How Jobbbler works</p>
        <h1>Search once. Let your agent handle the repetition.</h1>
        <p>
          Job search repeats itself. Tell a compatible browser agent what kind of technology role
          you want. It can search, compare, and keep checking. If you choose a role with Apply on
          Jobbbler, it asks before preparing one private application and again before Jobbbler
          submits the exact application you reviewed. The conversation stays in your agent app. No
          plug-in or separate server setup is needed.
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
            Every role in this demo supports Apply on Jobbbler. Opening the site alone gives an
            agent no new authority to use your private data or submit anything: it must first ask
            for short-lived permission to prepare one application, and submission requires a second,
            explicit decision in the same agent chat. On your final yes, Jobbbler records your
            consent, submits that unchanged application once, and saves a receipt. If you say no,
            nothing is shared or sent.
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
                Open Agent activity to see the action, its status, and the result. The rest of
                Jobbbler stays a familiar job portal.
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
            No account is needed to search or apply. Adding an email for recovery is optional and
            does not approve data use, submission, or email updates. If you clear this browser, the
            same verified email and a one-time code can restore your applications and saved searches
            from the same agent chat.
          </p>
        </div>
      </section>

      <footer className={styles["footer"]}>
        <p>
          Browse roles yourself, or copy the example request and start the same search in your agent
          chat.
        </p>
        <div className={styles["footerActions"]}>
          <Link className={styles["primaryAction"]} href="/jobs">
            Browse open roles <ArrowRightIcon aria-hidden="true" size={16} />
          </Link>
          <a className={styles["secondaryAction"]} href="#one-request">
            See the example request
          </a>
        </div>
      </footer>
    </article>
  );
}
