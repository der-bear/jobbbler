"use client";

import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ToolActivity } from "@jobbbler/contracts";
import { Button } from "@jobbbler/ui";

import type { WebMcpRegistrationStatus } from "./webmcp-provider";

import styles from "./agent-activity-rail.module.css";

export interface AgentActivityRailProps {
  readonly activities: readonly ToolActivity[];
  readonly className?: string;
  readonly maxItems?: number;
  readonly onClearHistory?: () => Promise<void>;
  readonly onHistoryCleared?: () => void;
  readonly onOpenGuide?: () => void;
  readonly webMcpStatus: WebMcpRegistrationStatus;
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
    label: "Decision requested",
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

function sameActivityTarget(left: ToolActivity, right: ToolActivity): boolean {
  const leftIds = new Set(left.affectedResourceIds);
  const rightIds = new Set(right.affectedResourceIds);
  if (leftIds.size === 0 || rightIds.size === 0) {
    return leftIds.size === 0 && rightIds.size === 0 && left.correlationId === right.correlationId;
  }
  return leftIds.size === rightIds.size && [...leftIds].every((id) => rightIds.has(id));
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
      previous.activity.safeSummary === activity.safeSummary &&
      sameActivityTarget(previous.activity, activity)
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
  const safeSummary =
    activity.safeSummary === "Application workspace created." ||
    activity.safeSummary === "Application draft created."
      ? "Application prepared."
      : activity.safeSummary === "Application draft reopened."
        ? "Application reopened."
        : activity.safeSummary === "Application draft updated."
          ? "Application updated."
          : activity.safeSummary;
  if (activity.toolName !== "start_application" && safeSummary === activity.safeSummary) {
    return activity;
  }
  return {
    ...activity,
    toolName: activity.toolName === "start_application" ? "prepare_application" : activity.toolName,
    safeSummary,
  };
}

export function activityReceiptCount(activities: readonly ToolActivity[]): number {
  return groupedActivities(activities).length;
}

function emptyActivityCopy(status: WebMcpRegistrationStatus): Readonly<{
  detail: string;
  title: string;
}> {
  if (status === "ready") {
    return {
      title: "No agent activity yet",
      detail:
        "Start a task in a compatible agent client. Each Jobbbler tool call will appear here.",
    };
  }
  if (status === "checking" || status === "preparing") {
    return {
      title: "Getting agent tools ready",
      detail: "Tool calls will appear here as soon as setup finishes.",
    };
  }
  if (status === "error") {
    return {
      title: "Agent tools need a retry",
      detail: "Retry above. The job portal still works normally.",
    };
  }
  return {
    title: "No agent activity in this browser",
    detail: "Open Jobbbler in a WebMCP-compatible agent client to use the tools.",
  };
}

export function AgentActivityRail({
  activities,
  className,
  maxItems = 4,
  onClearHistory,
  onHistoryCleared,
  onOpenGuide,
  webMcpStatus,
}: AgentActivityRailProps) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearStatus, setClearStatus] = useState<"idle" | "pending" | "error">("idle");
  const [clearAnnouncement, setClearAnnouncement] = useState("");
  const [showAll, setShowAll] = useState(false);
  const cancelClearRef = useRef<HTMLButtonElement | null>(null);
  const itemLimit = Math.max(0, maxItems);
  const allActivities = groupedActivities(activities);
  const hiddenCount = itemLimit === 0 ? 0 : Math.max(0, allActivities.length - itemLimit);
  const visibleActivities =
    itemLimit === 0 ? [] : (showAll ? allActivities : allActivities.slice(-itemLimit)).toReversed();
  const latestSourceActivity = activities.at(-1);
  const latestActivity =
    latestSourceActivity === undefined ? undefined : normalizeLegacyActivity(latestSourceActivity);
  const emptyCopy = emptyActivityCopy(webMcpStatus);

  useEffect(() => {
    if (!confirmingClear) return;
    cancelClearRef.current?.focus();
  }, [confirmingClear]);

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
      <p aria-live="polite" className="sr-only">
        {clearAnnouncement}
      </p>

      {visibleActivities.length === 0 ? (
        <div className={styles["empty"]} role="status">
          <p>{emptyCopy.title}</p>
          <span>{emptyCopy.detail}</span>
          {onOpenGuide === undefined ? null : (
            <Button
              onClick={onOpenGuide}
              size="sm"
              trailingIcon={<ArrowRightIcon aria-hidden="true" size={14} />}
              variant="quiet"
            >
              Open guide
            </Button>
          )}
        </div>
      ) : (
        <>
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
          {hiddenCount > 0 ? (
            <div className={styles["historySummary"]}>
              <span>
                {showAll
                  ? `Showing all ${String(allActivities.length)} actions.`
                  : `Showing the ${String(itemLimit)} most recent actions.`}
              </span>
              <Button onClick={() => setShowAll((current) => !current)} size="sm" variant="quiet">
                {showAll ? "Show recent only" : `Show ${String(hiddenCount)} earlier`}
              </Button>
            </div>
          ) : null}
          {onClearHistory === undefined ? null : (
            <div className={styles["historyActions"]}>
              {confirmingClear ? (
                <div aria-label="Confirm clearing agent activity" role="group">
                  <p>Clear all activity history?</p>
                  <span>This removes the activity shown here. It cannot be undone.</span>
                  <div>
                    <Button
                      disabled={clearStatus === "pending"}
                      onClick={() => {
                        setConfirmingClear(false);
                        setClearStatus("idle");
                      }}
                      ref={cancelClearRef}
                      size="sm"
                      variant="quiet"
                    >
                      Cancel
                    </Button>
                    <Button
                      loading={clearStatus === "pending"}
                      onClick={() => {
                        setClearStatus("pending");
                        void onClearHistory()
                          .then(() => {
                            setConfirmingClear(false);
                            setClearStatus("idle");
                            setClearAnnouncement("Activity history cleared.");
                            onHistoryCleared?.();
                          })
                          .catch(() => setClearStatus("error"));
                      }}
                      size="sm"
                      variant="danger"
                    >
                      Clear history
                    </Button>
                  </div>
                  {clearStatus === "error" ? (
                    <p className={styles["clearError"]} role="alert">
                      Activity history could not be cleared. Try again.
                    </p>
                  ) : null}
                </div>
              ) : (
                <Button
                  onClick={() => {
                    setClearAnnouncement("");
                    setConfirmingClear(true);
                    setClearStatus("idle");
                  }}
                  size="sm"
                  variant="quiet"
                >
                  Clear history
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
