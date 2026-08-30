import { afterEach, describe, expect, it } from "vitest";

import { searchAlertPreparationFixture } from "@jobbbler/storage/contract-tests";

import { createPostgresStorage, migratePostgres, resetPostgresSchema } from "./index.js";

const databaseUrl = process.env["POSTGRES_TEST_DATABASE_URL"];

describe.skipIf(databaseUrl === undefined)("PostgreSQL search-alert preparation lifecycle", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function create() {
    const storage = createPostgresStorage(databaseUrl!);
    close = () => storage.close();
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);
    return storage;
  }

  it("rolls back every cleanup artifact when exact challenge deletion fails", async () => {
    const storage = await create();
    const fixture = await searchAlertPreparationFixture(storage, { suffix: "031" });
    await storage.sql.unsafe(`
      CREATE FUNCTION jobbbler.fail_search_alert_preparation_cleanup()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        RAISE EXCEPTION 'forced search-alert cleanup failure';
      END
      $function$
    `);
    await storage.sql.unsafe(`
      CREATE TRIGGER fail_search_alert_preparation_cleanup
      BEFORE DELETE ON jobbbler.entity_records
      FOR EACH ROW
      WHEN (OLD.kind = 'verification_challenge')
      EXECUTE FUNCTION jobbbler.fail_search_alert_preparation_cleanup()
    `);

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
    await expect(
      storage.sql<{ readonly count: string }[]>`
        SELECT count(*)::text AS count
        FROM jobbbler.entity_records
        WHERE kind = 'verification_challenge' AND id = ${fixture.challenge.id}`,
    ).resolves.toEqual([{ count: "1" }]);
  });

  it("serializes approved-intent creation against unattended expiry", async () => {
    const storage = await create();
    const fixture = await searchAlertPreparationFixture(storage, { suffix: "032" });

    const [begin, purge] = await Promise.allSettled([
      storage.searchAlertPreparation.beginApproved(fixture.beginApprovedInput),
      storage.searchAlertPreparation.purgeExpired({
        now: fixture.afterReviewExpiry,
        limit: 1,
      }),
    ]);

    expect(purge.status).toBe("fulfilled");
    const saga = await storage.idempotency.get(fixture.saga.scope, fixture.saga.key);
    const intent = await storage.idempotency.get(
      fixture.approvedIntent.scope,
      fixture.approvedIntent.key,
    );
    if (begin.status === "fulfilled") {
      expect(begin.value).toEqual({ inserted: true, record: fixture.approvedIntent });
      expect(purge).toEqual({ status: "fulfilled", value: 0 });
      expect(saga).toEqual(fixture.saga);
      expect(intent).toEqual(fixture.approvedIntent);
    } else {
      expect(begin.reason).toMatchObject({ code: "CONFLICT" });
      expect(purge).toEqual({ status: "fulfilled", value: 1 });
      expect(saga).toBeNull();
      expect(intent).toBeNull();
    }
  });

  it("lets concurrent bounded purgers claim different expired sagas", async () => {
    const storage = await create();
    const first = await searchAlertPreparationFixture(storage, { suffix: "033" });
    const second = await searchAlertPreparationFixture(storage, { suffix: "034" });

    const removed = await Promise.all([
      storage.searchAlertPreparation.purgeExpired({
        now: first.afterReviewExpiry,
        limit: 1,
      }),
      storage.searchAlertPreparation.purgeExpired({
        now: first.afterReviewExpiry,
        limit: 1,
      }),
    ]);

    expect(removed.reduce((total, count) => total + count, 0)).toBe(2);
    await expect(storage.idempotency.get(first.saga.scope, first.saga.key)).resolves.toBeNull();
    await expect(storage.idempotency.get(second.saga.scope, second.saga.key)).resolves.toBeNull();
  });
});
