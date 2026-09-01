import type { ObservableWorkerMode } from "./observability.js";

export type WorkerMode = ObservableWorkerMode | "idle";

export function parseWorkerMode(value: string): WorkerMode {
  if (
    value === "catalog_once" ||
    value === "catalog_service" ||
    value === "alert_once" ||
    value === "alert_service" ||
    value === "all_once" ||
    value === "all_service" ||
    value === "idle"
  ) {
    return value;
  }
  throw new Error("Unsupported JOBBBLER_WORKER_MODE.");
}

export function resolveWorkerMode(
  environment: Readonly<Record<string, string | undefined>>,
): WorkerMode {
  return parseWorkerMode(
    environment["JOBBBLER_WORKER_MODE"] ??
      (environment["NODE_ENV"] === "production" ? "alert_service" : "idle"),
  );
}

export function runsCatalog(mode: WorkerMode): boolean {
  return (
    mode === "catalog_once" ||
    mode === "catalog_service" ||
    mode === "all_once" ||
    mode === "all_service"
  );
}

export function runsAlerts(mode: WorkerMode): boolean {
  return (
    mode === "alert_once" ||
    mode === "alert_service" ||
    mode === "all_once" ||
    mode === "all_service"
  );
}

export function runsOnce(mode: WorkerMode): boolean {
  return mode.endsWith("_once");
}
