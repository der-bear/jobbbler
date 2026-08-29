import { ArrowRightIcon, CheckIcon } from "@phosphor-icons/react";
import Link from "next/link";

import { webMcpCatalog } from "@/lib/webmcp-catalog";

import type { RegisteredToolSummary } from "./webmcp-provider";
import { stableWebMcpCoreNames } from "./webmcp-registration";

import styles from "./agent-guide.module.css";

const totalCatalogTools = webMcpCatalog.reduce((count, route) => count + route.tools.length, 0);
const catalogTools = new Map(
  webMcpCatalog.flatMap((route) => route.tools.map((tool) => [tool.name, tool] as const)),
);

const outcomeWorkflows = [
  {
    title: "Find and compare",
    description: "Search, inspect source-backed facts, and compare a shortlist.",
  },
  {
    title: "Watch what changed",
    description: "Save a search, then return only to new, updated, closed, or changed roles.",
  },
  {
    title: "Apply with control",
    description: "Prepare answers while consent and final confirmation stay with the person.",
  },
] as const;

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

export function AgentTools({ tools, webMcpAvailable }: AgentToolsProps) {
  const registeredByName = new Map(tools.map((tool) => [tool.name, tool]));
  const alwaysTools = stableWebMcpCoreNames.flatMap((name) => {
    const tool = registeredByName.get(name) ?? catalogTools.get(name);
    return tool === undefined ? [] : [tool];
  });
  const coreNames = new Set<string>(stableWebMcpCoreNames);
  const contextTools = tools.filter((tool) => !coreNames.has(tool.name));

  return (
    <div className={styles["guide"]}>
      <section aria-labelledby="panel-always-tools">
        <div className={styles["sectionHeading"]}>
          <h3 id="panel-always-tools">Site-wide</h3>
          <span>{String(alwaysTools.length)}</span>
        </div>
        <p className={styles["note"]}>
          {webMcpAvailable
            ? "The agent keeps these entry points across every Jobbbler page."
            : "A compatible agent browser receives these entry points on every page."}
        </p>
        <ul className={styles["toolList"]}>
          {alwaysTools.map((tool) => (
            <li key={tool.name}>
              <div>
                <code>{tool.name}</code>
                <span>{tool.readOnly ? "Read" : "Action"}</span>
              </div>
              <p>{toolPurpose(tool)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="panel-context-tools" className={styles["context"]}>
        <div className={styles["sectionHeading"]}>
          <h3 id="panel-context-tools">This page</h3>
          <span>{String(contextTools.length)}</span>
        </div>
        {contextTools.length === 0 ? (
          <p className={styles["empty"]}>
            No additional page tools are active in this browser state.
          </p>
        ) : (
          <ul className={styles["toolList"]}>
            {contextTools.map((tool) => (
              <li key={tool.name}>
                <div>
                  <code>{tool.name}</code>
                  <span>{tool.readOnly ? "Read" : "Action"}</span>
                </div>
                <p>{toolPurpose(tool)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link className={styles["moreLink"]} href="/about/webmcp">
        View all {String(totalCatalogTools)} tools <ArrowRightIcon aria-hidden="true" size={14} />
      </Link>
    </div>
  );
}

export function AgentGuide() {
  return (
    <div className={styles["guide"]}>
      <section aria-labelledby="guide-try">
        <p className={styles["promise"]}>No setup. Every agent action stays visible.</p>
        <h3 id="guide-try">Try it with one prompt</h3>
        <ol className={styles["steps"]}>
          <li>Open Jobbbler in a WebMCP-compatible agent browser.</li>
          <li>
            Ask:{" "}
            <q>
              Find senior remote product roles in Europe over €100k, compare the strongest three,
              and save this search.
            </q>
          </li>
          <li>Watch the search and this activity log update together.</li>
        </ol>
      </section>

      <section aria-labelledby="guide-outcomes" className={styles["outcomes"]}>
        <h3 id="guide-outcomes">What it helps with</h3>
        <ul>
          {outcomeWorkflows.map((workflow) => (
            <li key={workflow.title}>
              <CheckIcon aria-hidden="true" size={14} />
              <div>
                <strong>{workflow.title}</strong>
                <p>{workflow.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="guide-control" className={styles["control"]}>
        <h3 id="guide-control">The person stays in control</h3>
        <p>
          Data sharing and final application submission require separate, explicit decisions. The
          agent can prepare the work; it cannot grant itself permission.
        </p>
      </section>

      <Link className={styles["moreLink"]} href="/about/webmcp">
        How the agent layer works <ArrowRightIcon aria-hidden="true" size={14} />
      </Link>
    </div>
  );
}
