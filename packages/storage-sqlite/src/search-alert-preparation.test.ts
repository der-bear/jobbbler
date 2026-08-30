import { afterAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { searchAlertPreparationFixture } from "@jobbbler/storage/contract-tests";

import { createSqliteStorage, openSqliteDatabase } from "./index.js";

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it("rolls back every cleanup artifact when exact challenge deletion fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jobbbler-alert-preparation-rollback-"));
  temporaryDirectories.push(directory);
  const filename = join(directory, "jobbbler.sqlite");
  const storage = createSqliteStorage(filename);
  const fixture = await searchAlertPreparationFixture(storage, { suffix: "021" });
  const inspection = openSqliteDatabase(filename);
  inspection.exec(`
    CREATE TRIGGER fail_exact_search_alert_challenge_cleanup
    BEFORE DELETE ON verification_challenges
    WHEN OLD.id = '${fixture.challenge.id}'
    BEGIN
      SELECT RAISE(ABORT, 'forced search-alert cleanup failure');
    END
  `);

  try {
    await expect(storage.searchAlertPreparation.expire(fixture.expireInput)).rejects.toThrow(
      /forced search-alert cleanup failure/u,
    );
    await expect(storage.savedSearches.getById(fixture.savedSearch.id)).resolves.toEqual(
      fixture.savedSearch,
    );
    await expect(storage.idempotency.get(fixture.saga.scope, fixture.saga.key)).resolves.toEqual(
      fixture.saga,
    );
    await expect(
      storage.idempotency.get(fixture.requestEvidence.scope, fixture.requestEvidence.key),
    ).resolves.toEqual(fixture.requestEvidence);
    expect(
      inspection
        .prepare("SELECT count(*) AS count FROM verification_challenges WHERE id = ?")
        .get(fixture.challenge.id),
    ).toEqual({ count: 1 });
  } finally {
    inspection.close();
    storage.close();
  }
});
