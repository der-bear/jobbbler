"use client";

import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { ToolActivity } from "@jobbbler/contracts";

import { activityReceiptCount, AgentActivityRail } from "./agent-activity-rail";
import { AgentGuide, AgentTools } from "./agent-guide";
import {
  useWebMcp,
  type RegisteredToolSummary,
  type WebMcpRegistrationStatus,
} from "./webmcp-provider";

import styles from "./agent-panel.module.css";

const panelTabs = ["activity", "tools", "guide"] as const;
type PanelTab = (typeof panelTabs)[number];

interface AgentPanelSurfaceProps {
  readonly activities: readonly ToolActivity[];
  readonly modal?: boolean;
  readonly onClose: () => void;
  readonly onWidthChange: (width: number) => void;
  readonly registeredTools: readonly RegisteredToolSummary[];
  readonly retry: () => void;
  readonly status: WebMcpRegistrationStatus;
  readonly supported: boolean;
  readonly width: number;
}

function connectionCopy(
  status: WebMcpRegistrationStatus,
  toolCount: number,
): Readonly<{ label: string; detail: string }> {
  if (status === "checking") {
    return { label: "Checking agent support", detail: "The job portal is ready while we check." };
  }
  if (status === "unsupported") {
    return {
      label: "Browser mode",
      detail: "Use a WebMCP-compatible agent browser to activate tools.",
    };
  }
  if (status === "preparing") {
    return { label: "Preparing agent tools", detail: "The safe tool set is being registered." };
  }
  if (status === "error") {
    return { label: "Agent tools need a retry", detail: "The job portal still works normally." };
  }
  return {
    label: "WebMCP ready",
    detail: `${String(toolCount)} tools active. Discovery is automatic.`,
  };
}

function statusIcon(status: WebMcpRegistrationStatus) {
  if (status === "ready") return <CheckCircleIcon aria-hidden="true" size={16} weight="fill" />;
  if (status === "checking" || status === "preparing") {
    return <ArrowClockwiseIcon aria-hidden="true" className={styles["spin"]} size={16} />;
  }
  if (status === "error") {
    return <WarningCircleIcon aria-hidden="true" size={16} weight="fill" />;
  }
  return <InfoIcon aria-hidden="true" size={16} />;
}

export function AgentPanelSurface({
  activities,
  modal = false,
  onClose,
  onWidthChange,
  registeredTools,
  retry,
  status,
  supported,
  width,
}: AgentPanelSurfaceProps) {
  const [selectedTab, setSelectedTab] = useState<PanelTab>("activity");
  const mountedAt = useRef(Date.now());
  const panelRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Partial<Record<PanelTab, HTMLButtonElement | null>>>({});
  const userSelectedTab = useRef(false);
  const latestActivity = activities.at(-1);
  const receiptCount = activityReceiptCount(activities);
  const connection = connectionCopy(status, registeredTools.length);

  useEffect(() => {
    if (latestActivity === undefined) return;
    if (Date.parse(latestActivity.startedAt) < mountedAt.current) return;
    if (!userSelectedTab.current) setSelectedTab("activity");
  }, [latestActivity]);

  useEffect(() => {
    if (modal) tabRefs.current.activity?.focus();
  }, [modal]);

  function selectTab(tab: PanelTab, userInitiated = true) {
    if (userInitiated) userSelectedTab.current = true;
    setSelectedTab(tab);
    tabRefs.current[tab]?.focus();
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, tab: PanelTab) {
    const index = panelTabs.indexOf(tab);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectTab(panelTabs[(index + 1) % panelTabs.length] ?? "activity");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectTab(panelTabs[(index - 1 + panelTabs.length) % panelTabs.length] ?? "activity");
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTab("activity");
    } else if (event.key === "End") {
      event.preventDefault();
      selectTab("guide");
    }
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      onWidthChange(Math.min(560, Math.max(320, startWidth + startX - moveEvent.clientX)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onWidthChange(Math.min(560, width + 20));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onWidthChange(Math.max(320, width - 20));
    } else if (event.key === "Home") {
      event.preventDefault();
      onWidthChange(320);
    } else if (event.key === "End") {
      event.preventDefault();
      onWidthChange(560);
    }
  }

  function handlePanelKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (!modal || event.key !== "Tab") return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => !element.hidden && element.closest("[hidden]") === null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <aside
      aria-label="Agent view"
      aria-modal={modal || undefined}
      className={styles["panel"]}
      onKeyDown={handlePanelKey}
      ref={panelRef}
      role={modal ? "dialog" : undefined}
    >
      <div
        aria-label="Resize agent panel"
        aria-orientation="vertical"
        aria-valuemax={560}
        aria-valuemin={320}
        aria-valuenow={width}
        className={styles["resizer"]}
        onKeyDown={resizeWithKeyboard}
        onPointerDown={startResize}
        role="separator"
        tabIndex={0}
      />

      <header className={styles["header"]}>
        <div className={styles["titleRow"]}>
          <h2>Agent view</h2>
          <button
            aria-label="Close agent panel"
            className={styles["close"]}
            onClick={onClose}
            type="button"
          >
            <XIcon aria-hidden="true" size={17} />
          </button>
        </div>

        <div
          aria-label="WebMCP status"
          className={styles["connection"]}
          data-status={status}
          role="status"
        >
          {statusIcon(status)}
          <span>
            <strong>{connection.label}</strong>
            <small>{connection.detail}</small>
          </span>
          {status === "error" ? (
            <button onClick={retry} type="button">
              Retry
            </button>
          ) : null}
        </div>
      </header>

      <div aria-label="Agent panel sections" className={styles["tabs"]} role="tablist">
        {panelTabs.map((tab) => {
          const label =
            tab === "activity"
              ? `Activity${receiptCount === 0 ? "" : ` · ${String(receiptCount)}`}`
              : tab === "tools"
                ? "Tools"
                : "Guide";
          return (
            <button
              aria-controls={`agent-panel-${tab}`}
              aria-selected={selectedTab === tab}
              id={`agent-tab-${tab}`}
              key={tab}
              onClick={() => selectTab(tab, true)}
              onKeyDown={(event) => handleTabKey(event, tab)}
              ref={(node) => {
                tabRefs.current[tab] = node;
              }}
              role="tab"
              tabIndex={selectedTab === tab ? 0 : -1}
              type="button"
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby="agent-tab-guide"
        className={styles["content"]}
        hidden={selectedTab !== "guide"}
        id="agent-panel-guide"
        role="tabpanel"
        tabIndex={0}
      >
        <AgentGuide />
      </div>
      <div
        aria-labelledby="agent-tab-activity"
        className={styles["content"]}
        hidden={selectedTab !== "activity"}
        id="agent-panel-activity"
        role="tabpanel"
        tabIndex={0}
      >
        <AgentActivityRail
          activities={activities}
          webMcpAvailable={supported && status !== "error"}
        />
      </div>
      <div
        aria-labelledby="agent-tab-tools"
        className={styles["content"]}
        hidden={selectedTab !== "tools"}
        id="agent-panel-tools"
        role="tabpanel"
        tabIndex={0}
      >
        <AgentTools tools={registeredTools} webMcpAvailable={supported && status !== "error"} />
      </div>
    </aside>
  );
}

export function AgentPanel({
  modal,
  onClose,
  onWidthChange,
  width,
}: Readonly<{
  modal: boolean;
  onClose: () => void;
  onWidthChange: (width: number) => void;
  width: number;
}>) {
  const webMcp = useWebMcp();
  return (
    <AgentPanelSurface
      activities={webMcp.activities}
      modal={modal}
      onClose={onClose}
      onWidthChange={onWidthChange}
      registeredTools={webMcp.registeredTools}
      retry={webMcp.retry}
      status={webMcp.status}
      supported={webMcp.supported}
      width={width}
    />
  );
}
