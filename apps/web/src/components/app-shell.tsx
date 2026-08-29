"use client";

import { BellSimpleIcon, BriefcaseIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ThemeToggle } from "@jobbbler/ui";

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

  return (
    <div className={styles["shell"]}>
      <a className={styles["skipLink"]} href="#main-content">
        Skip to content
      </a>
      <header className={styles["header"]}>
        <Link aria-label="Jobbbler" className={styles["wordmark"]} href="/">
          Jobbbler
          <span>Signal over noise</span>
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
            About WebMCP
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main id="main-content">{children}</main>
    </div>
  );
}
