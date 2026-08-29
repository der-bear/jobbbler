import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type { ToolActivity } from "@jobbbler/contracts";

import styles from "./agent-activity-rail.module.css";

export interface RegisteredToolListItem {
  readonly name: string;
  readonly purpose: string;
  readonly readOnly: boolean;
}

export interface AgentActivityRailProps {
  readonly activities: readonly ToolActivity[];
  readonly className?: string;
  readonly initiallyExpanded?: boolean;
  readonly maxItems?: number;
  readonly registeredToolCount: number;
  readonly status?: ReactNode;
  readonly tools?: readonly RegisteredToolListItem[];
  readonly webMcpAvailable: boolean;
}

interface ActivityPresentation {
  readonly icon: ReactNode;
  readonly label: string;
}

const activityPresentation: Readonly<Record<ToolActivity["status"], ActivityPresentation>> = {
  running: {
    icon: <ArrowClockwiseIcon aria-hidden="true" className={styles["spin"]} size={15} />,
    label: "Running",
  },
  completed: {
    icon: <CheckCircleIcon aria-hidden="true" size={15} weight="fill" />,
    label: "Completed",
  },
  requires_user_action: {
    icon: <WarningCircleIcon aria-hidden="true" size={15} weight="fill" />,
    label: "Approval needed",
  },
  failed: {
    icon: <WarningCircleIcon aria-hidden="true" size={15} weight="fill" />,
    label: "Needs attention",
  },
  cancelled: {
    icon: <XIcon aria-hidden="true" size={15} weight="bold" />,
    label: "Cancelled",
  },
};

function compactTime(value: string): string {
  return `${value.slice(11, 16)} UTC`;
}

function toolLabel(toolName: string): string {
  return toolName.replaceAll("_", " ");
}

function toolCountLabel(count: number): string {
  return `${String(count)} action${count === 1 ? "" : "s"} available on this page`;
}

function disclosureStatus(activities: readonly ToolActivity[], webMcpAvailable: boolean): string {
  if (activities.some((activity) => activity.status === "requires_user_action")) {
    return "Approval needed";
  }
  if (activities.some((activity) => activity.status === "failed")) return "Needs attention";
  if (activities.some((activity) => activity.status === "running")) return "Agent working";
  if (activities.length > 0) return "Recently updated";
  return webMcpAvailable ? "Available" : "Browser mode";
}

export function AgentActivityRail({
  activities,
  className,
  initiallyExpanded = false,
  maxItems = 4,
  registeredToolCount,
  status,
  tools = [],
  webMcpAvailable,
}: AgentActivityRailProps) {
  const itemLimit = Math.max(0, maxItems);
  const visibleActivities = itemLimit === 0 ? [] : activities.slice(-itemLimit).reverse();
  const needsAttention = activities.some(
    (activity) =>
      activity.status === "running" ||
      activity.status === "requires_user_action" ||
      activity.status === "failed",
  );

  return (
    <details
      className={`${styles["rail"]} ${className ?? ""}`}
      open={initiallyExpanded || needsAttention || undefined}
    >
      <summary className={styles["summary"]}>
        <span>
          <strong>Agent activity</strong>
        </span>
        <span className={styles["summaryStatus"]} data-attention={String(needsAttention)}>
          {disclosureStatus(activities, webMcpAvailable)}
          <CaretDownIcon aria-hidden="true" className={styles["chevron"]} size={14} />
        </span>
      </summary>

      <div className={styles["body"]}>
        <header className={styles["header"]}>
          <div>
            <h2>What changed</h2>
          </div>
          {status ?? (
            <span
              aria-label={webMcpAvailable ? "WebMCP available" : "WebMCP unavailable"}
              className={styles["capability"]}
              data-available={String(webMcpAvailable)}
              role="status"
            >
              <InfoIcon
                aria-hidden="true"
                size={14}
                weight={webMcpAvailable ? "fill" : "regular"}
              />
              <span>{webMcpAvailable ? "WebMCP available" : "WebMCP unavailable"}</span>
            </span>
          )}
        </header>
        <p className={styles["toolCount"]}>{toolCountLabel(registeredToolCount)}</p>

        {tools.length > 0 ? (
          <section aria-label="Available WebMCP tools" className={styles["toolList"]}>
            <h3>Tools an agent can call here</h3>
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
          </section>
        ) : null}

        {visibleActivities.length === 0 ? (
          <p className={styles["empty"]} role="status">
            Nothing changed by an agent in this session. You can use every feature yourself.
          </p>
        ) : (
          <ol aria-live="polite" aria-relevant="additions text" className={styles["timeline"]}>
            {visibleActivities.map((activity) => {
              const presentation = activityPresentation[activity.status];
              const time = activity.completedAt ?? activity.startedAt;
              return (
                <li
                  aria-busy={activity.status === "running" || undefined}
                  data-status={activity.status}
                  key={activity.id}
                >
                  <span className={styles["marker"]}>{presentation.icon}</span>
                  <div className={styles["entry"]}>
                    <div className={styles["entryHeader"]}>
                      <code>{toolLabel(activity.toolName)}</code>
                      <span className={styles["state"]}>{presentation.label}</span>
                    </div>
                    <p>{activity.safeSummary}</p>
                    <time dateTime={time}>{compactTime(time)}</time>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </details>
  );
}
