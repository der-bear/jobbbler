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
    copy: "The agent turns what you ask for into exact search criteria and matching roles.",
  },
  {
    title: "Compare",
    copy: "It checks the facts and explains which roles fit best.",
  },
  {
    title: "Monitor",
    copy: "Save the search once. Jobbbler checks it on a schedule and reports only what changed.",
  },
  {
    title: "Apply",
    copy: "The agent prepares truthful answers and a cover letter. Nothing is sent until you approve the exact application.",
  },
] as const;

const agentCan = [
  "Find, compare, and keep checking matching roles",
  "Prepare application answers from facts you provide",
  "Restore your private workspace when you ask",
] as const;

const decisionsForYou = [
  "Facts only you can provide",
  "Whether the agent may prepare this application",
  "The exact application and recipient shown before anything is sent",
  "The final yes or no that controls submission",
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
          you want. It can search, compare, and keep checking. If you choose a role, it asks before
          preparing one private application and again before Jobbbler sends the exact version shown
          to you. The conversation stays in your agent app. No plug-in or separate server setup is
          needed.
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
            Opening Jobbbler gives an agent no permission to use your personal data. It asks before
            preparing one application and again before sending it. The first yes records consent to
            process the answers for that application. The second yes applies only to the unchanged
            application and recipient shown to you. If you say no at either step, that step does not
            happen.
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
            Every role in this demo supports Apply on Jobbbler.
          </p>
          <div className={styles["proof"]}>
            <EyeIcon aria-hidden="true" size={21} />
            <div>
              <strong>A window into the agent layer.</strong>
              <p>
                For this demonstration, Agent activity shows judges and developers which action an
                agent called and whether it worked. Everyday visitors can ignore it.
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
            No account is needed to search, save, or apply in this browser. Email is optional and is
            used only for updates or restoring your private workspace. It never counts as consent to
            use personal data or submit an application.
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
