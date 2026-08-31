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

  it("documents server-only PostgreSQL configuration and independent web and worker deployment", async () => {
    const runbook = await readRepositoryFile("docs/operations/deployment.md");

    expect(runbook).toContain("DATABASE_URL");
    expect(runbook).toContain("server-only");
    expect(runbook).toContain("--target web");
    expect(runbook).toContain("--target worker");
    expect(runbook).toContain("/api/health/ready");
  });
});
