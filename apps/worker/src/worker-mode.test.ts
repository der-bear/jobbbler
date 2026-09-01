import { describe, expect, it } from "vitest";

import { resolveWorkerMode, runsAlerts, runsCatalog } from "./worker-mode.js";

describe("worker mode", () => {
  it("keeps production alert-only unless catalog ingestion is explicitly requested", () => {
    expect(resolveWorkerMode({ NODE_ENV: "production" })).toBe("alert_service");
    expect(resolveWorkerMode({ NODE_ENV: "development" })).toBe("idle");
    expect(resolveWorkerMode({ NODE_ENV: "production", JOBBBLER_WORKER_MODE: "all_service" })).toBe(
      "all_service",
    );
  });

  it("keeps catalog and alert capabilities explicit", () => {
    expect(runsCatalog("alert_service")).toBe(false);
    expect(runsAlerts("alert_service")).toBe(true);
    expect(runsCatalog("catalog_once")).toBe(true);
    expect(runsAlerts("catalog_once")).toBe(false);
  });
});
