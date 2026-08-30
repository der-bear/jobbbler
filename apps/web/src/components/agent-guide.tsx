"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import Link from "next/link";

import { webMcpCatalog } from "@/lib/webmcp-catalog";

import type { RegisteredToolSummary } from "./webmcp-provider";
import { AgentExamplePrompt } from "./agent-example-prompt";

import styles from "./agent-guide.module.css";

const totalCatalogTools = webMcpCatalog.reduce((count, route) => count + route.tools.length, 0);

export interface AgentToolsProps {
  readonly tools: readonly RegisteredToolSummary[];
  readonly webMcpAvailable: boolean;
}

const compactPurposes: Readonly<Record<string, string>> = {
  plan_job_workflow: "Get the safe steps for a Jobbbler goal.",
  get_search_filters: "Learn the exact search filters Jobbbler accepts.",
  search_jobs: "Search the public technology-job catalog.",
  open_job_details: "Open a known role and its source-backed facts.",
  prepare_application:
    "Prepare one application for a managed internal role without sharing or submitting data.",
  open_jobbbler_page: "Open another Jobbbler workspace.",
};

function toolPurpose(tool: RegisteredToolSummary): string {
  return compactPurposes[tool.name] ?? tool.purpose;
}

const requestTools = new Set([
  "request_search_alert",
  "request_application_assistance",
  "request_submission_review",
]);

const decisionTools = new Set([
  "decide_search_alert",
  "decide_application_assistance",
  "decide_application_submission",
]);

const capabilityGroups = [
  { title: "Find", routes: ["*", "/"] },
  { title: "Inspect and compare", routes: ["/jobs/:jobId", "/compare"] },
  { title: "Alerts", routes: ["/saved"] },
  { title: "Apply", routes: ["/apply/:draftId"] },
] as const;

function ToolRow({
  tool,
}: Readonly<{
  tool: RegisteredToolSummary;
}>) {
  return (
    <li>
      <div className={styles["toolHeading"]}>
        <code>{tool.name}</code>
        {requestTools.has(tool.name) ? (
          <span className={styles["humanDecision"]}>Asks the person</span>
        ) : decisionTools.has(tool.name) ? (
          <span className={styles["humanDecision"]}>Relays the decision</span>
        ) : null}
      </div>
      <p>{toolPurpose(tool)}</p>
    </li>
  );
}

export function AgentTools({ tools, webMcpAvailable }: AgentToolsProps) {
  const registeredByName = new Map(tools.map((tool) => [tool.name, tool]));
  const visibleToolCount = webMcpAvailable ? tools.length : totalCatalogTools;

  return (
    <div className={styles["guide"]}>
      <section aria-labelledby="panel-available-tools">
        <div className={styles["sectionHeading"]}>
          <h3 id="panel-available-tools">
            {webMcpAvailable ? "Active tools" : "Capability catalog"}
          </h3>
          <span>{String(visibleToolCount)} tools</span>
        </div>
        <p className={styles["note"]}>
          {webMcpAvailable
            ? `${String(visibleToolCount)} Jobbbler tools are active here and stay available as the agent moves through the site. Private actions still check ownership and the current step.`
            : "Preview the same 26 tools a compatible browser agent discovers automatically."}
        </p>
        <div className={styles["capabilityGroups"]}>
          {capabilityGroups.map((group) => {
            const catalogGroupTools = webMcpCatalog
              .filter((route) => (group.routes as readonly string[]).includes(route.route))
              .flatMap((route) => route.tools);
            const groupTools = webMcpAvailable
              ? catalogGroupTools.filter((tool) => registeredByName.has(tool.name))
              : catalogGroupTools;
            if (groupTools.length === 0) return null;
            return (
              <section aria-label={`${group.title} capabilities`} key={group.title}>
                <h4>{group.title}</h4>
                <ul className={styles["toolList"]}>
                  {groupTools.map((tool) => {
                    const registered = registeredByName.get(tool.name);
                    return <ToolRow key={tool.name} tool={registered ?? tool} />;
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function AgentGuide() {
  return (
    <div className={styles["guide"]}>
      <section aria-labelledby="guide-try">
        <p className={styles["promise"]}>No separate MCP server to install.</p>
        <h3 id="guide-try">Start in your agent chat</h3>
        <p className={styles["guideText"]}>
          Share Jobbbler&apos;s link and describe what you need. When the agent opens the site, it
          discovers all 26 available actions automatically.
        </p>
        <ol className={styles["guideSteps"]}>
          <li>
            <span>1</span>
            <p>Share the link and say what you need</p>
          </li>
          <li>
            <span>2</span>
            <p>Let the agent search, compare, or keep checking</p>
          </li>
          <li>
            <span>3</span>
            <p>Review only when it asks to use your data or submit</p>
          </li>
        </ol>
        <AgentExamplePrompt className={styles["prompt"]} promptClassName={styles["promptText"]} />
        <p className={styles["planner"]}>
          Not sure where to begin? Your agent can ask Jobbbler for a safe step-by-step plan. The
          planner only advises; it never takes action.
        </p>
      </section>

      <div className={styles["guideColumns"]}>
        <section aria-labelledby="guide-tools">
          <h3 id="guide-tools">What the tools handle</h3>
          <ul>
            <li>Search and compare matching roles</li>
            <li>Save a search and report only what changed</li>
            <li>Prepare truthful answers and a short motivation note from facts you provide</li>
            <li>Open the employer&apos;s application page when Jobbbler cannot submit directly</li>
          </ul>
        </section>
        <section aria-labelledby="guide-control">
          <h3 id="guide-control">What stays with you</h3>
          <ul>
            <li>Facts only you can provide</li>
            <li>Permission for the agent to prepare this application</li>
            <li>Consent to process your data — and the right to withdraw it</li>
            <li>The exact final submission decision</li>
          </ul>
        </section>
      </div>

      <p className={styles["panelNote"]}>
        Activity shows what happened. Tools shows all 26 capabilities and the actions that need a
        decision.
      </p>

      <Link className={styles["moreLink"]} href="/about/webmcp">
        Read how Jobbbler works <ArrowRightIcon aria-hidden="true" size={14} />
      </Link>
    </div>
  );
}
