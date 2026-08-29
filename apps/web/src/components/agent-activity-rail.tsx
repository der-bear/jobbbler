import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type { ToolActivity } from "@jobbbler/contracts";

import styles from "./agent-activity-rail.module.css";

export interface AgentActivityRailProps {
  readonly activities: readonly ToolActivity[];
  readonly className?: string;
  readonly maxItems?: number;
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
    label: "Complete",
  },
  requires_user_action: {
    icon: <WarningCircleIcon aria-hidden="true" size={15} weight="fill" />,
    label: "Approval needed",
  },
  failed: {
    icon: <WarningCircleIcon aria-hidden="true" size={15} weight="fill" />,
    label: "Error",
  },
  cancelled: {
    icon: <XIcon aria-hidden="true" size={15} weight="bold" />,
    label: "Cancelled",
  },
};

function durationLabel(startedAt: string, completedAt: string | null): string | null {
  if (completedAt === null) return null;
  const elapsed = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return elapsed < 1_000 ? String(elapsed) + " ms" : (elapsed / 1_000).toFixed(1) + " s";
}

export function AgentActivityRail({
  activities,
  className,
  maxItems = 4,
  webMcpAvailable,
}: AgentActivityRailProps) {
  const itemLimit = Math.max(0, maxItems);
  const visibleActivities = itemLimit === 0 ? [] : activities.slice(-itemLimit).reverse();
  const latestActivity = activities.at(-1);

  return (
    <section
      aria-label="Agent activity log"
      className={[styles["rail"], className].filter(Boolean).join(" ")}
    >
      <p aria-live="polite" className="sr-only">
        {latestActivity === undefined
          ? ""
          : activityPresentation[latestActivity.status].label + ": " + latestActivity.safeSummary}
      </p>

      {visibleActivities.length === 0 ? (
        <div className={styles["empty"]} role="status">
          <p>{webMcpAvailable ? "No agent actions yet." : "No agent actions in this browser."}</p>
          <span>
            {webMcpAvailable
              ? "When an agent uses a tool, its outcome appears here."
              : "The job portal still works normally."}
          </span>
        </div>
      ) : (
        <ol className={styles["timeline"]}>
          {visibleActivities.map((activity) => {
            const presentation = activityPresentation[activity.status];
            const duration = durationLabel(activity.startedAt, activity.completedAt);
            return (
              <li
                aria-busy={activity.status === "running" || undefined}
                data-status={activity.status}
                key={activity.id}
              >
                <span className={styles["marker"]}>{presentation.icon}</span>
                <div className={styles["entry"]}>
                  <p>{activity.safeSummary}</p>
                  <div className={styles["meta"]}>
                    <span>{presentation.label}</span>
                    <code>{activity.toolName}</code>
                    {duration === null ? null : <span>{duration}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
