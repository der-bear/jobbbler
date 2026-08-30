"use client";

import { BellSimpleIcon, BriefcaseIcon, CircleIcon, FileTextIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";

import { ThemeToggle } from "@jobbbler/ui";

import { AgentPanel } from "./agent-panel";
import { useWebMcp } from "./webmcp-provider";

import styles from "./app-shell.module.css";

const navigation = [
  { href: "/jobs", label: "Jobs", icon: BriefcaseIcon },
  { href: "/saved", label: "Alerts", icon: BellSimpleIcon },
  { href: "/applications", label: "Applications", icon: FileTextIcon },
] as const;

function isCurrentRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppFooter() {
  return (
    <footer className={styles["siteFooter"]}>
      <span>© 2026 Jobbbler</span>
      <nav aria-label="Secondary navigation">
        <Link href="/about/webmcp">How it works</Link>
        <a href="https://github.com/der-bear/jobbbler" rel="noreferrer" target="_blank">
          Source code
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </nav>
    </footer>
  );
}

export function AppHeaderSurface({
  agentButtonRef,
  agentOpen,
  agentStatus,
  agentStatusLabel,
  blocked = false,
  onAgentToggle,
  pathname,
}: Readonly<{
  agentButtonRef?: Ref<HTMLButtonElement>;
  agentOpen: boolean;
  agentStatus: "checking" | "preparing" | "ready" | "unsupported" | "error";
  agentStatusLabel: string;
  blocked?: boolean;
  onAgentToggle: () => void;
  pathname: string;
}>) {
  return (
    <header className={styles["header"]} inert={blocked || undefined}>
      <Link aria-label="Jobbbler home" className={styles["wordmark"]} href="/">
        Jobbbler
      </Link>
      <nav aria-label="Primary navigation" className={styles["navigation"]}>
        {navigation.map(({ href, label, icon: Icon }) => (
          <Link
            aria-current={isCurrentRoute(pathname, href) ? "page" : undefined}
            className={styles["navLink"]}
            href={href}
            key={href}
          >
            <Icon aria-hidden="true" size={17} weight="regular" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className={styles["actions"]}>
        <button
          aria-expanded={agentOpen}
          aria-label={`Agent view — ${agentStatusLabel}`}
          className={styles["agentView"]}
          data-status={agentStatus}
          onClick={onAgentToggle}
          ref={agentButtonRef}
          type="button"
        >
          <CircleIcon aria-hidden="true" size={8} weight="fill" />
          <span>Agent view</span>
          <span className="sr-only">{agentStatusLabel}</span>
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const webMcp = useWebMcp();
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [agentPanelWidth, setAgentPanelWidth] = useState(380);
  const [compactAgentPanel, setCompactAgentPanel] = useState(false);
  const agentTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1080px)");
    const update = () => {
      setCompactAgentPanel(query.matches);
      if (query.matches) setAgentPanelOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  function closeAgentPanel() {
    setAgentPanelOpen(false);
    window.requestAnimationFrame(() => agentTriggerRef.current?.focus());
  }

  const agentStatus =
    webMcp.status === "ready"
      ? `${String(webMcp.registeredToolCount)} tools`
      : webMcp.status === "unsupported"
        ? "Browser mode"
        : webMcp.status === "error"
          ? "Needs retry"
          : "Connecting";

  return (
    <div className={styles["shell"]}>
      <a className={styles["skipLink"]} href="#main-content">
        Skip to content
      </a>
      <AppHeaderSurface
        agentButtonRef={agentTriggerRef}
        agentOpen={agentPanelOpen}
        agentStatus={webMcp.status}
        agentStatusLabel={agentStatus}
        blocked={agentPanelOpen && compactAgentPanel}
        onAgentToggle={() => (agentPanelOpen ? closeAgentPanel() : setAgentPanelOpen(true))}
        pathname={pathname}
      />
      <div
        className={styles["contentFrame"]}
        data-agent-open={String(agentPanelOpen)}
        style={{ "--agent-panel-size": `${String(agentPanelWidth)}px` } as CSSProperties}
      >
        <main id="main-content" inert={agentPanelOpen && compactAgentPanel}>
          {children}
          <AppFooter />
        </main>
        {agentPanelOpen ? (
          <AgentPanel
            modal={compactAgentPanel}
            onClose={closeAgentPanel}
            onWidthChange={setAgentPanelWidth}
            width={agentPanelWidth}
          />
        ) : null}
      </div>
    </div>
  );
}
