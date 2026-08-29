import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useId, type ReactNode } from "react";

import type { ToolActivity } from "@jobbbler/contracts";

import styles from "./agent-activity-rail.module.css";

export interface AgentActivityRailProps {
  readonly activities: readonly ToolActivity[];
  readonly className?: string;
  readonly maxItems?: number;
  readonly registeredToolCount: number;
  readonly status?: ReactNode;
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
  return `${String(count)} tool${count === 1 ? "" : "s"} registered`;
}

export function AgentActivityRail({
  activities,
  className,
  maxItems = 4,
  registeredToolCount,
  status,
  webMcpAvailable,
}: AgentActivityRailProps) {
  const itemLimit = Math.max(0, maxItems);
  const visibleActivities = itemLimit === 0 ? [] : activities.slice(-itemLimit).reverse();
  const headingId = useId();

  return (
    <section className={`${styles["rail"]} ${className ?? ""}`} aria-labelledby={headingId}>
      <header className={styles["header"]}>
        <div>
          <p className={styles["eyebrow"]}>Agent activity</p>
          <h2 id={headingId}>What changed</h2>
        </div>
        {status ?? (
          <span
            aria-label={webMcpAvailable ? "WebMCP available" : "WebMCP unavailable"}
            className={styles["capability"]}
            data-available={String(webMcpAvailable)}
            role="status"
          >
            <InfoIcon aria-hidden="true" size={14} weight={webMcpAvailable ? "fill" : "regular"} />
            <span>{webMcpAvailable ? "WebMCP available" : "WebMCP unavailable"}</span>
          </span>
        )}
      </header>
      {status === undefined ? (
        <p className={styles["toolCount"]}>{toolCountLabel(registeredToolCount)}</p>
      ) : null}

      {visibleActivities.length === 0 ? (
        <p className={styles["empty"]} role="status">
          No agent activity yet. Your search remains fully usable without an agent.
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
    </section>
  );
}
