import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { seedDemoCatalog } from "../packages/storage-sqlite/src/seed.js";

const projectRoot = resolve(import.meta.dirname, "..");
const databasePath = resolve(projectRoot, ".data/jobbbler-e2e.sqlite");
const fixturePath = resolve(projectRoot, "fixtures/demo-catalog.json");

await Promise.all(
  [databasePath, `${databasePath}-shm`, `${databasePath}-wal`].map((path) =>
    rm(path, { force: true }),
  ),
);
await seedDemoCatalog(databasePath, fixturePath);

const server = spawn(
  "pnpm",
  [
    "--filter",
    "@jobbbler/web",
    "exec",
    "next",
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    cwd: projectRoot,
    env: { ...process.env, SQLITE_DATABASE_PATH: databasePath },
    stdio: "inherit",
  },
);

function forward(signal: NodeJS.Signals) {
  if (!server.killed) server.kill(signal);
}

process.once("SIGINT", () => forward("SIGINT"));
process.once("SIGTERM", () => forward("SIGTERM"));

server.once("error", (error) => {
  process.stderr.write(`Unable to start the e2e server: ${error.message}\n`);
  process.exitCode = 1;
});

server.once("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
