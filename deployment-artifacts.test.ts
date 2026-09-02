import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

async function readRepositoryFile(path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

describe("production deployment artifacts", () => {
  it("defines non-root Node 24 web and worker image targets from the frozen pnpm lock", async () => {
    const dockerfile = await readRepositoryFile("Dockerfile");
    const ignore = await readRepositoryFile(".dockerignore");

    expect(dockerfile).toContain("FROM node:24-bookworm AS base");
    expect(dockerfile).not.toContain("apt-get");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("pnpm --filter @jobbbler/worker deploy --legacy --prod");
    expect(dockerfile).toContain("AS web");
    expect(dockerfile).toContain("AS worker");
    expect(dockerfile).toContain("USER jobbbler");
    expect(dockerfile).toContain('CMD ["node", "apps/web/server.js"]');
    expect(dockerfile).toContain('CMD ["node", "apps/worker/dist/main.js"]');
    expect(dockerfile).toContain("apps/web/.next/standalone");
    expect(dockerfile).toContain("apps/web/.next/static");
    expect(dockerfile).toContain("/app/apps/web/public");
    expect(dockerfile).toContain("ARG NEXT_PUBLIC_SUPABASE_URL");
    expect(dockerfile).toContain("ARG NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(dockerfile).toContain("ARG NEXT_PUBLIC_SUPABASE_ACTIVITY_WAKEUPS");
    expect(dockerfile).toContain("ARG WEBMCP_ORIGIN_TRIAL_TOKEN");
    expect(dockerfile).toContain("ENV WEBMCP_ORIGIN_TRIAL_TOKEN=$WEBMCP_ORIGIN_TRIAL_TOKEN");
    expect(ignore).toContain(".env");
    expect(ignore).toContain("node_modules");
    expect(ignore).toContain("**/.next*");
    expect(ignore).toContain(".git");
  });

  it("runs the opt-in PostgreSQL/RLS suite after creating Supabase-compatible roles", async () => {
    const workflow = await readRepositoryFile(".github/workflows/ci.yml");

    expect(workflow).toContain("postgres-contract:");
    expect(workflow).toContain("postgres:16");
    expect(workflow).toContain("CREATE ROLE anon NOLOGIN");
    expect(workflow).toContain("CREATE ROLE authenticated NOLOGIN");
    expect(workflow).toContain("POSTGRES_TEST_DATABASE_URL");
    expect(workflow).toContain("pnpm --filter @jobbbler/storage-postgres test");
    expect(workflow).toContain("verify:");
    expect(workflow).toContain("docker-package:");
    expect(workflow).toContain("docker build --target web");
    expect(workflow).toContain("docker build --target worker");
  });

  it("schedules the bounded alert cycle from Supabase without enabling live feeds", async () => {
    const scheduler = await readRepositoryFile("infra/supabase/alert-cycle-scheduler.sql");

    expect(scheduler).toContain("create extension if not exists pg_net");
    expect(scheduler).toContain("create extension if not exists pg_cron");
    expect(scheduler).toContain("jobbbler_public_base_url");
    expect(scheduler).toContain("jobbbler_alert_cycle_secret");
    expect(scheduler).toContain("cron.schedule(");
    expect(scheduler).toContain("jobbbler-alert-cycle");
    expect(scheduler).toContain("/api/internal/alert-cycle");
    expect(scheduler).toContain("'Authorization', 'Bearer '");
    expect(scheduler).toContain("timeout_milliseconds := 50000");
    expect(scheduler).not.toContain("all_service");
    expect(scheduler).not.toContain("catalog_service");
  });

  it("pins the Vercel web build to the Next.js workspace without losing monorepo packages", async () => {
    const configuration = JSON.parse(await readRepositoryFile("apps/web/vercel.json")) as Record<
      string,
      unknown
    >;
    const ignore = await readRepositoryFile(".gitignore");

    expect(configuration).toMatchObject({
      framework: "nextjs",
      installCommand: "cd ../.. && pnpm install --frozen-lockfile",
      buildCommand: "cd ../.. && pnpm --filter @jobbbler/web build",
    });
    expect(configuration).not.toHaveProperty("outputDirectory");
    expect(configuration).not.toHaveProperty("crons");
    expect(ignore).toContain(".vercel/");
  });

  it("documents server-only PostgreSQL configuration and independent web and worker deployment", async () => {
    const runbook = await readRepositoryFile("docs/operations/deployment.md");

    expect(runbook).toContain("DATABASE_URL");
    expect(runbook).toContain("server-only");
    expect(runbook).toContain("--target web");
    expect(runbook).toContain("--target worker");
    expect(runbook).toContain("/api/health/ready");
    expect(runbook).toContain("WEBMCP_ORIGIN_TRIAL_TOKEN");
    expect(runbook).toMatch(/Supabase\s+Cron invokes that endpoint every ten minutes/u);
    expect(runbook).toContain("infra/supabase/alert-cycle-scheduler.sql");
    expect(runbook).toContain("alert_once");
    expect(runbook).toMatch(/Root\s+Directory to `apps\/web`/u);
  });
});
