"use client";

import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

import styles from "./webmcp-status.module.css";
import { useWebMcp } from "./webmcp-provider";

export function WebMcpStatus() {
  const { registeredToolCount, retry, status } = useWebMcp();
  const ready = status === "ready" && registeredToolCount > 0;
  const label =
    status === "checking"
      ? "Checking browser support"
      : status === "unsupported"
        ? "WebMCP unavailable · Browser mode"
        : status === "preparing"
          ? "Preparing page tools"
          : status === "error"
            ? "WebMCP registration needs attention"
            : registeredToolCount === 0
              ? "WebMCP available · No tools here"
              : `WebMCP ready · ${String(registeredToolCount)} tools`;
  const detail =
    status === "checking"
      ? "The conventional interface is ready while support is detected."
      : status === "unsupported"
        ? "Everything remains available without an agent."
        : status === "preparing"
          ? "The route-specific tool set is registering."
          : status === "error"
            ? "The page remains usable; no tools were exposed."
            : registeredToolCount === 0
              ? "Open search, a role, or comparison to expose tools."
              : "Only tools relevant to this page are exposed.";

  return (
    <div
      aria-label="WebMCP status"
      className={styles["status"]}
      data-available={String(ready)}
      data-status={status}
      role="status"
    >
      {ready ? (
        <CheckCircleIcon aria-hidden="true" size={16} weight="fill" />
      ) : status === "preparing" || status === "checking" ? (
        <ArrowClockwiseIcon aria-hidden="true" className={styles["spin"]} size={16} />
      ) : status === "error" ? (
        <WarningCircleIcon aria-hidden="true" size={16} weight="fill" />
      ) : (
        <InfoIcon aria-hidden="true" size={16} />
      )}
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
        {status === "error" ? (
          <button onClick={retry} type="button">
            Retry registration
          </button>
        ) : null}
      </span>
    </div>
  );
}
