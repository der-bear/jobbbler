import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { seedDemoCatalog } from "../../packages/storage-sqlite/src/seed.js";

export default async function globalSetup(): Promise<void> {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const databasePath = resolve(projectRoot, ".data/jobbbler-e2e.sqlite");
  const fixturePath = resolve(projectRoot, "fixtures/demo-catalog.json");

  await Promise.all(
    [databasePath, `${databasePath}-shm`, `${databasePath}-wal`].map((path) =>
      rm(path, { force: true }),
    ),
  );
  await seedDemoCatalog(databasePath, fixturePath);
}
