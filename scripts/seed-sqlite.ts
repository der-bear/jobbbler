import { resolve } from "node:path";

import { seedDemoCatalog } from "../packages/storage-sqlite/src/seed.js";

const databasePath = resolve(
  process.argv[2] ?? process.env["SQLITE_DATABASE_PATH"] ?? ".data/jobbbler.sqlite",
);
const fixturePath = resolve(process.argv[3] ?? "fixtures/demo-catalog.json");
const result = await seedDemoCatalog(databasePath, fixturePath);

process.stdout.write(
  `Seeded ${String(result.jobs)} jobs across ${String(result.organizations)} organizations: ${databasePath}\n`,
);
