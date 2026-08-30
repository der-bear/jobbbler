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

const approvalTools = new Set([
  "request_search_alert",
  "decide_search_alert",
  "request_application_assistance",
  "decide_application_assistance",
  "request_submission_review",
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
        {approvalTools.has(tool.name) ? (
          <span className={styles["humanDecision"]}>Human decision</span>
        ) : null}
      </div>
      <p>{toolPurpose(tool)}</p>
    </li>
  );
}

export function AgentTools({ tools, webMcpAvailable }: AgentToolsProps) {
  const registeredByName = new Map(tools.map((tool) => [tool.name, tool]));

  return (
    <div className={styles["guide"]}>
      <section aria-labelledby="panel-available-tools">
        <div className={styles["sectionHeading"]}>
          <h3 id="panel-available-tools">Available tools</h3>
          <span>{String(totalCatalogTools)} tools</span>
        </div>
        <p className={styles["note"]}>
          {webMcpAvailable
            ? "The same capability set stays discoverable across Jobbbler. Private actions still require an owned draft and the correct stage."
            : "A compatible agent browser discovers this capability set automatically."}
        </p>
        <div className={styles["capabilityGroups"]}>
          {capabilityGroups.map((group) => {
            const groupTools = webMcpCatalog
              .filter((route) => (group.routes as readonly string[]).includes(route.route))
              .flatMap((route) => route.tools);
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
        <h3 id="guide-try">Use Jobbbler from your agent chat</h3>
        <p className={styles["guideText"]}>
          The example includes this site&apos;s address. Once the agent opens Jobbbler, it discovers
          the available actions automatically.
        </p>
        <ol className={styles["guideSteps"]}>
          <li>
            <span>1</span>
            <p>Copy the complete request</p>
          </li>
          <li>
            <span>2</span>
            <p>Paste it into your agent client</p>
          </li>
          <li>
            <span>3</span>
            <p>Review requested consent or a final action in your agent client</p>
          </li>
        </ol>
        <AgentExamplePrompt className={styles["prompt"]} promptClassName={styles["promptText"]} />
      </section>

      <div className={styles["guideColumns"]}>
        <section aria-labelledby="guide-tools">
          <h3 id="guide-tools">What the tools handle</h3>
          <ul>
            <li>Search, inspect, and compare roles</li>
            <li>Monitor saved searches for changes</li>
            <li>Prepare answers and a short motivation note for a managed internal role</li>
            <li>
              For external roles, use the validated employer page only when available; otherwise
              stop
            </li>
          </ul>
        </section>
        <section aria-labelledby="guide-control">
          <h3 id="guide-control">What stays with you</h3>
          <ul>
            <li>Missing facts the agent asks for</li>
            <li>Approve, decline, or withdraw assistance in your external agent client</li>
            <li>Consent to process your data — and the right to withdraw it</li>
            <li>The exact final submission decision in your external agent client</li>
          </ul>
        </section>
      </div>

      <p className={styles["panelNote"]}>
        Activity shows what was called. Tools shows what the agent discovered.
      </p>

      <Link className={styles["moreLink"]} href="/about/webmcp">
        See how it works <ArrowRightIcon aria-hidden="true" size={14} />
      </Link>
    </div>
  );
}
