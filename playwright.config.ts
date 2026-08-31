import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://127.0.0.1:3100";
const usesExternalServer = process.env["PLAYWRIGHT_BASE_URL"] !== undefined;
const projectRoot = import.meta.dirname;
const e2eDatabasePath = resolve(projectRoot, ".data/jobbbler-e2e.sqlite");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  // Next's development compiler owns one shared route graph. Serial browser
  // journeys avoid cross-file cold-compilation reloads that can invalidate an
  // unrelated page while still exercising every flow end to end.
  workers: 1,
  retries: process.env["CI"] === undefined ? 1 : 2,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
      },
    },
  ],
  ...(usesExternalServer
    ? {}
    : {
        webServer: {
          command:
            "node --disable-warning=DEP0205 --import tsx scripts/prepare-e2e.ts && pnpm --filter @jobbbler/web exec next dev --webpack --hostname 127.0.0.1 --port 3100",
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            SQLITE_DATABASE_PATH: e2eDatabasePath,
            NOTIFICATION_DRIVER: "capture",
            ALLOW_LOCAL_OTP_CAPTURE: "true",
            PUBLIC_BASE_URL: baseURL,
            NEXT_DIST_DIR: ".next-e2e",
          },
        },
      }),
});
