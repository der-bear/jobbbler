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
    "Create or reopen one private Jobbbler application, without sharing or submitting data.",
  get_applications: "List private applications without returning their answers.",
  open_jobbbler_page: "Open another Jobbbler page.",
  enable_workspace_recovery: "Optionally add passwordless recovery to this private workspace.",
  recover_jobbbler_workspace:
    "Restore applications and saved searches with the email and code you provide.",
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
  { title: "Find", summary: "Plan and search", routes: ["*", "/"] },
  {
    title: "Inspect and compare",
    summary: "Read role facts and compare a shortlist",
    routes: ["/jobs/:jobId", "/compare"],
  },
  {
    title: "Saved searches",
    summary: "Save, monitor, reopen, pause, or remove",
    routes: ["/saved"],
  },
  {
    title: "Apply",
    summary: "Prepare, review, consent, and submit",
    routes: ["/apply/:draftId"],
  },
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
            ? `${String(visibleToolCount)} Jobbbler tools are active here and stay available as the agent moves through the site. Private actions still check ownership and the current workflow step.`
            : `Preview the same ${String(totalCatalogTools)} tools an agent-enabled browser discovers automatically.`}
        </p>
        <div className={styles["capabilityGroups"]}>
          {capabilityGroups.map((group, index) => {
            const catalogGroupTools = webMcpCatalog
              .filter((route) => (group.routes as readonly string[]).includes(route.route))
              .flatMap((route) => route.tools);
            const groupTools = webMcpAvailable
              ? catalogGroupTools.filter((tool) => registeredByName.has(tool.name))
              : catalogGroupTools;
            if (groupTools.length === 0) return null;
            return (
              <details className={styles["capabilityGroup"]} key={group.title} open={index === 0}>
                <summary>
                  <span className={styles["groupHeading"]}>
                    <strong>{group.title}</strong>
                    <small>{group.summary}</small>
                  </span>
                  <span className={styles["groupCount"]}>{String(groupTools.length)}</span>
                </summary>
                <ul className={styles["toolList"]}>
                  {groupTools.map((tool) => {
                    const registered = registeredByName.get(tool.name);
                    return <ToolRow key={tool.name} tool={registered ?? tool} />;
                  })}
                </ul>
              </details>
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
        <h3 id="guide-try">Start in your agent chat</h3>
        <p className={styles["guideText"]}>
          Copy the request below into your agent chat. Your agent opens Jobbbler and finds the
          available actions.
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
          Your agent can also ask for a safe step-by-step plan. The planner only advises; it never
          takes action.
        </p>
      </section>

      <div className={styles["guideColumns"]}>
        <section aria-labelledby="guide-tools">
          <h3 id="guide-tools">What the tools handle</h3>
          <ul>
            <li>Search and compare matching roles</li>
            <li>Save a search and report only what changed</li>
            <li>Optionally add an email so applications and saved searches can be recovered</li>
            <li>Restore applications and saved searches with the email and code you provide</li>
            <li>
              Prepare truthful answers and a role-specific cover letter; your CV stays with you and
              your agent
            </li>
            <li>Show every completed value before relaying your final submission decision</li>
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

      <details className={styles["technicalDetails"]}>
        <summary>Technical details</summary>
        <p>
          Jobbbler exposes {String(totalCatalogTools)} WebMCP tools directly from the site. An
          agent-enabled browser discovers them automatically, with no separate MCP server to
          install.
        </p>
      </details>

      <Link className={styles["moreLink"]} href="/about/webmcp">
        Read how Jobbbler works <ArrowRightIcon aria-hidden="true" size={14} />
      </Link>
    </div>
  );
}
