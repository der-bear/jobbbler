"use client";

import { BellSimpleIcon, BriefcaseIcon, CircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { ThemeToggle } from "@jobbbler/ui";

import { AgentPanel } from "./agent-panel";
import { useWebMcp } from "./webmcp-provider";

import styles from "./app-shell.module.css";

const navigation = [
  { href: "/", label: "Search", icon: BriefcaseIcon },
  { href: "/saved", label: "Saved", icon: BellSimpleIcon },
] as const;

function isCurrentRoute(pathname: string, href: string): boolean {
  return href === "/" ? pathname === href : pathname.startsWith(href);
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const webMcp = useWebMcp();
  const [agentPanelOpen, setAgentPanelOpen] = useState(true);
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
      <header className={styles["header"]} inert={agentPanelOpen && compactAgentPanel}>
        <Link aria-label="Jobbbler" className={styles["wordmark"]} href="/">
          Jobbbler
          <span>Find once. Stay updated. Apply with control.</span>
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
          <Link className={styles["webmcpLink"]} href="/about/webmcp">
            Works with agents
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <div
        className={styles["contentFrame"]}
        data-agent-open={String(agentPanelOpen)}
        style={{ "--agent-panel-size": `${String(agentPanelWidth)}px` } as CSSProperties}
      >
        <main id="main-content" inert={agentPanelOpen && compactAgentPanel}>
          {children}
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
      {agentPanelOpen ? null : (
        <button
          aria-expanded={false}
          aria-label={`Open agent panel — ${agentStatus}`}
          className={styles["agentTrigger"]}
          data-status={webMcp.status}
          onClick={() => setAgentPanelOpen(true)}
          ref={agentTriggerRef}
          type="button"
        >
          <CircleIcon aria-hidden="true" size={8} weight="fill" />
          Agent layer
          <span>{agentStatus}</span>
        </button>
      )}
    </div>
  );
}
