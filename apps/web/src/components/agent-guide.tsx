import { ArrowRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";

import { workflowPlans } from "@/features/webmcp-workflows";
import { webMcpCatalog } from "@/lib/webmcp-catalog";

import type { RegisteredToolSummary } from "./webmcp-provider";

import styles from "./agent-guide.module.css";

const totalCatalogTools = webMcpCatalog.reduce((count, route) => count + route.tools.length, 0);

export interface AgentToolsProps {
  readonly tools: readonly RegisteredToolSummary[];
}

export function AgentTools({ tools }: AgentToolsProps) {
  const activeNames = new Set(tools.map(({ name }) => name));
  const inactiveRoutes = webMcpCatalog
    .map((route) => ({
      ...route,
      tools: route.tools.filter((tool) => !activeNames.has(tool.name)),
    }))
    .filter((route) => route.tools.length > 0);

  return (
    <div className={styles["guide"]}>
      <section aria-labelledby="panel-tools">
        <h3 id="panel-tools">Active on this page</h3>
        {tools.length === 0 ? (
          <p className={styles["empty"]}>
            No agent browser detected, so no tools are registered right now. The whole site keeps
            working normally without one.
          </p>
        ) : (
          <ul>
            {tools.map((tool) => (
              <li key={tool.name}>
                <div>
                  <code>{tool.name}</code>
                  {tool.readOnly ? <span>read-only</span> : null}
                </div>
                <p>{tool.purpose}</p>
              </li>
            ))}
          </ul>
        )}
        <p className={styles["note"]}>
          The set changes with the page and its state: navigating swaps these tools for the next
          page's set.
        </p>
      </section>

      <section aria-labelledby="panel-all-tools" className={styles["catalog"]}>
        <h3 id="panel-all-tools">
          {activeNames.size === 0
            ? `All ${String(totalCatalogTools)} site tools by page`
            : `Available on other pages · ${String(totalCatalogTools)} tools site-wide`}
        </h3>
        {inactiveRoutes.map((route) => (
          <div className={styles["catalogRoute"]} key={route.route}>
            <h4>
              {route.title} <code>{route.route}</code>
            </h4>
            {route.note === undefined ? null : <p className={styles["note"]}>{route.note}</p>}
            <ul>
              {route.tools.map((tool) => (
                <li key={tool.name}>
                  <div>
                    <code>{tool.name}</code>
                    {tool.readOnly ? <span>read-only</span> : null}
                  </div>
                  <p>{tool.purpose}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <Link className={styles["moreLink"]} href="/about/webmcp">
        How Jobbbler works with agents <ArrowRightIcon aria-hidden="true" size={14} />
      </Link>
    </div>
  );
}

export interface AgentGuideProps {
  readonly status?: ReactNode;
}

export function AgentGuide({ status }: AgentGuideProps) {
  return (
    <div className={styles["guide"]}>
      {status}

      <section aria-labelledby="guide-try">
        <h3 id="guide-try">Try it in 10 seconds</h3>
        <ol>
          <li>
            Open this page in an agent browser — the ChatGPT desktop app, or Chrome 149+ with the
            WebMCP flag.
          </li>
          <li>
            Ask in plain words:{" "}
            <em>“Find senior remote product roles in Europe over €100k, then save an alert.”</em>
          </li>
          <li>
            The agent discovers this page's tools on its own. Nothing to install, declare, or
            configure.
          </li>
        </ol>
      </section>

      <section aria-labelledby="guide-workflows">
        <h3 id="guide-workflows">Suggested workflows</h3>
        <ul className={styles["workflows"]}>
          {Object.entries(workflowPlans).map(([goal, plan]) => (
            <li key={goal}>
              <strong>{plan.title}</strong>
              <p>
                {plan.steps
                  .map((step) => (step.tool === null ? "you" : step.tool.replaceAll("_", " ")))
                  .filter((value, index, all) => all.indexOf(value) === index)
                  .join(" → ")}
              </p>
            </li>
          ))}
        </ul>
        <p className={styles["note"]}>
          An agent can fetch the same plans itself through the <code>plan_job_workflow</code> tool —
          advisory only, it never acts.
        </p>
      </section>

      <Link className={styles["moreLink"]} href="/about/webmcp">
        How Jobbbler works with agents <ArrowRightIcon aria-hidden="true" size={14} />
      </Link>
    </div>
  );
}
