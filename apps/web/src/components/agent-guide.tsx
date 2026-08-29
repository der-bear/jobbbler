import { ArrowRightIcon } from "@phosphor-icons/react";
import Link from "next/link";

import { webMcpCatalog } from "@/lib/webmcp-catalog";

import type { RegisteredToolSummary } from "./webmcp-provider";
import { stableWebMcpCoreNames } from "./webmcp-registration";

import styles from "./agent-guide.module.css";

const totalCatalogTools = webMcpCatalog.reduce((count, route) => count + route.tools.length, 0);
const catalogTools = new Map(
  webMcpCatalog.flatMap((route) => route.tools.map((tool) => [tool.name, tool] as const)),
);

export const agentExamplePrompt =
  "Find senior remote product roles in Europe over €100k, compare the strongest three, and save this search.";

export interface AgentToolsProps {
  readonly tools: readonly RegisteredToolSummary[];
  readonly webMcpAvailable: boolean;
}

const compactPurposes: Readonly<Record<string, string>> = {
  plan_job_workflow: "Get the safe steps for a Jobbbler goal.",
  get_site_capabilities: "See what the site can do and where approval stays required.",
  get_search_filters: "Learn the exact search filters Jobbbler accepts.",
  search_jobs: "Search the public technology-job catalog.",
  open_job_details: "Open a known role and its source-backed facts.",
  open_jobbbler_page: "Open another Jobbbler workspace.",
};

function toolPurpose(tool: RegisteredToolSummary): string {
  return compactPurposes[tool.name] ?? tool.purpose;
}

function toolTitle(name: string): string {
  const title = name.replaceAll("_", " ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

const approvalTools = new Set([
  "approve_application_access",
  "approve_data_permission",
  "confirm_reviewed_application",
  "submit_application",
]);

const capabilityGroups = [
  { title: "Find", routes: ["*", "/"] },
  { title: "Inspect and compare", routes: ["/jobs/:jobId", "/compare"] },
  { title: "Alerts", routes: ["/saved"] },
  { title: "Apply", routes: ["/apply/:draftId"] },
] as const;

function ToolRow({
  active = false,
  tool,
}: Readonly<{
  active?: boolean;
  tool: RegisteredToolSummary;
}>) {
  return (
    <li data-active={active || undefined}>
      <div className={styles["toolTitle"]}>
        <strong>{toolTitle(tool.name)}</strong>
        {active ? <span className={styles["activeMark"]}>Available now</span> : null}
      </div>
      <code>{tool.name}</code>
      <p>{toolPurpose(tool)}</p>
      <div className={styles["toolMeta"]}>
        <span>{tool.readOnly ? "Read" : "Action"}</span>
        {approvalTools.has(tool.name) ? <span>Human step</span> : null}
      </div>
    </li>
  );
}

export function AgentTools({ tools, webMcpAvailable }: AgentToolsProps) {
  const registeredByName = new Map(tools.map((tool) => [tool.name, tool]));
  const alwaysTools = stableWebMcpCoreNames.flatMap((name) => {
    const tool = registeredByName.get(name) ?? catalogTools.get(name);
    return tool === undefined ? [] : [tool];
  });
  const coreNames = new Set<string>(stableWebMcpCoreNames);
  const contextTools = tools.filter((tool) => !coreNames.has(tool.name));
  const activeNames = new Set(tools.map((tool) => tool.name));

  return (
    <div className={styles["guide"]}>
      <section aria-labelledby="panel-active-tools">
        <div className={styles["sectionHeading"]}>
          <h3 id="panel-active-tools">Active now</h3>
          <span>{String(tools.length)} tools</span>
        </div>
        <p className={styles["note"]}>
          {webMcpAvailable
            ? "These are registered for the current page and state."
            : "A compatible agent browser registers this set automatically."}
        </p>
        <div className={styles["activeGroups"]}>
          <div>
            <h4>Everywhere</h4>
            <ul className={styles["toolList"]}>
              {alwaysTools.map((tool) => (
                <ToolRow active key={tool.name} tool={tool} />
              ))}
            </ul>
          </div>
          {contextTools.length === 0 ? null : (
            <div>
              <h4>This page</h4>
              <ul className={styles["toolList"]}>
                {contextTools.map((tool) => (
                  <ToolRow active key={tool.name} tool={tool} />
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="panel-all-tools" className={styles["catalog"]}>
        <div className={styles["sectionHeading"]}>
          <h3 id="panel-all-tools">All capabilities</h3>
          <span>{String(totalCatalogTools)} tools</span>
        </div>
        <div className={styles["capabilityGroups"]}>
          {capabilityGroups.map((group) => {
            const groupTools = webMcpCatalog
              .filter((route) => (group.routes as readonly string[]).includes(route.route))
              .flatMap((route) => route.tools);
            return (
              <section aria-label={`${group.title} capabilities`} key={group.title}>
                <h4>{group.title}</h4>
                <ul className={styles["toolList"]}>
                  {groupTools.map((tool) => (
                    <ToolRow active={activeNames.has(tool.name)} key={tool.name} tool={tool} />
                  ))}
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
        <p className={styles["promise"]}>No separate server or connector setup.</p>
        <h3 id="guide-try">Ask for the outcome</h3>
        <p className={styles["guideText"]}>
          Open Jobbbler in a WebMCP-compatible browser and use one plain-language request.
        </p>
        <q className={styles["prompt"]}>{agentExamplePrompt}</q>
      </section>

      <section aria-labelledby="guide-control" className={styles["control"]}>
        <h3 id="guide-control">The person stays in control</h3>
        <p>
          Data sharing and final application submission require separate, explicit decisions. The
          agent can prepare the work; it cannot grant itself permission.
        </p>
      </section>

      <Link className={styles["moreLink"]} href="/about/webmcp">
        See how it works <ArrowRightIcon aria-hidden="true" size={14} />
      </Link>
    </div>
  );
}
