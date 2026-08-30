"use client";

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
    label: "Your decision needed",
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
  if (!Number.isFinite(elapsed) || elapsed <= 0) return null;
  return elapsed < 1_000 ? String(elapsed) + " ms" : (elapsed / 1_000).toFixed(1) + " s";
}

export function groupedActivities(activities: readonly ToolActivity[]): readonly Readonly<{
  activity: ToolActivity;
  count: number;
}>[] {
  const groups: { activity: ToolActivity; count: number }[] = [];
  for (const sourceActivity of activities) {
    const activity = normalizeLegacyActivity(sourceActivity);
    const previous = groups.at(-1);
    if (
      previous !== undefined &&
      previous.activity.toolName === activity.toolName &&
      previous.activity.status === activity.status &&
      previous.activity.safeSummary === activity.safeSummary
    ) {
      previous.activity = activity;
      previous.count += 1;
    } else {
      groups.push({ activity, count: 1 });
    }
  }
  return groups;
}

function normalizeLegacyActivity(activity: ToolActivity): ToolActivity {
  if (activity.toolName !== "start_application") return activity;
  return {
    ...activity,
    toolName: "prepare_application",
    safeSummary:
      activity.safeSummary === "Application workspace created."
        ? "Application prepared."
        : activity.safeSummary,
  };
}

export function activityReceiptCount(activities: readonly ToolActivity[]): number {
  return groupedActivities(activities).length;
}

export function AgentActivityRail({
  activities,
  className,
  maxItems = 4,
  webMcpAvailable,
}: AgentActivityRailProps) {
  const itemLimit = Math.max(0, maxItems);
  const visibleActivities =
    itemLimit === 0 ? [] : groupedActivities(activities).slice(-itemLimit).reverse();
  const latestSourceActivity = activities.at(-1);
  const latestActivity =
    latestSourceActivity === undefined ? undefined : normalizeLegacyActivity(latestSourceActivity);

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
          <p>{webMcpAvailable ? "No agent activity yet" : "No agent actions in this browser."}</p>
          {webMcpAvailable ? (
            <span>Tool calls and visible results will appear here.</span>
          ) : (
            <span>The job portal still works normally.</span>
          )}
        </div>
      ) : (
        <ol className={styles["timeline"]}>
          {visibleActivities.map(({ activity, count }) => {
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
                  <code>{activity.toolName}</code>
                  <div className={styles["meta"]}>
                    <span>{presentation.label}</span>
                    {count > 1 ? <span>{String(count)} similar calls grouped</span> : null}
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
