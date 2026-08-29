"use client";

import { CheckCircleIcon, InfoIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import styles from "./webmcp-status.module.css";

export function WebMcpStatus() {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: unknown }).modelContext;
    setAvailable(
      typeof modelContext === "object" &&
        modelContext !== null &&
        "registerTool" in modelContext &&
        typeof modelContext.registerTool === "function",
    );
  }, []);

  const label = available === true ? "WebMCP available" : "WebMCP unavailable · Browser mode";
  const detail =
    available === true
      ? "This browser supports page-aware tools."
      : "Everything remains available without an agent.";

  return (
    <div
      aria-label="WebMCP status"
      className={styles["status"]}
      data-available={String(available === true)}
      role="status"
    >
      {available === true ? (
        <CheckCircleIcon aria-hidden="true" size={16} weight="fill" />
      ) : (
        <InfoIcon aria-hidden="true" size={16} />
      )}
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}
