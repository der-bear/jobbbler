"use client";

import { BookmarkSimpleIcon, BriefcaseIcon, CircleIcon, FileTextIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";

import { ThemeToggle } from "@jobbbler/ui";

import { AgentPanel, maximumAgentPanelWidth } from "./agent-panel";
import { useWebMcp } from "./webmcp-provider";

import styles from "./app-shell.module.css";

const navigation = [
  { href: "/jobs", label: "Open roles", icon: BriefcaseIcon },
  { href: "/saved", label: "Saved searches", icon: BookmarkSimpleIcon },
  { href: "/applications", label: "My applications", icon: FileTextIcon },
] as const;

function isCurrentRoute(pathname: string, href: string): boolean {
  if (href === "/applications" && pathname.startsWith("/apply/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function PrimaryNavigation({
  className,
  pathname,
}: Readonly<{ className: string | undefined; pathname: string }>) {
  return (
    <nav aria-label="Primary navigation" className={`${styles["navigation"]} ${className ?? ""}`}>
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
  );
}

export function AppFooter() {
  return (
    <footer className={styles["siteFooter"]}>
      <span>© 2026 Jobbbler</span>
      <nav aria-label="Secondary navigation">
        <Link href="/about/webmcp">How it works</Link>
        <Link href="/privacy">Privacy</Link>
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
      <Link
        aria-label="Jobbbler home"
        className={styles["wordmark"]}
        data-status={agentStatus}
        href="/"
      >
        <span>Jobbbler</span>
        <CircleIcon aria-hidden="true" className={styles["wordmarkDot"]} size={7} weight="fill" />
      </Link>
      <PrimaryNavigation className={styles["desktopNavigation"]} pathname={pathname} />
      <div className={styles["actions"]}>
        <button
          aria-expanded={agentOpen}
          aria-label={`Agent activity — ${agentStatusLabel}`}
          className={styles["agentView"]}
          data-status={agentStatus}
          onClick={onAgentToggle}
          ref={agentButtonRef}
          type="button"
        >
          <span>Agent activity</span>
          <span className="sr-only">{agentStatusLabel}</span>
        </button>
        <ThemeToggle />
      </div>
      <PrimaryNavigation className={styles["mobileNavigation"]} pathname={pathname} />
    </header>
  );
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const webMcp = useWebMcp();
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [agentPanelWidth, setAgentPanelWidth] = useState(380);
  const [agentPanelMaximumWidth, setAgentPanelMaximumWidth] = useState(560);
  const [compactAgentPanel, setCompactAgentPanel] = useState(false);
  const agentTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1200px)");
    const update = () => {
      setCompactAgentPanel(query.matches);
      const maximumWidth = maximumAgentPanelWidth(window.innerWidth);
      setAgentPanelMaximumWidth(maximumWidth);
      if (!query.matches) {
        setAgentPanelWidth((current) => Math.min(current, maximumWidth));
      }
    };
    update();
    query.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
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
            maximumWidth={agentPanelMaximumWidth}
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
