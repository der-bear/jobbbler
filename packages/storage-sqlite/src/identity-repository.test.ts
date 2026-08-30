import { afterEach, describe, expect, it } from "vitest";

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  OwnerDeletionIntentRecord,
  OwnerIdentityRecord,
  OwnerRecoveryChallengeRecord,
  OwnerSessionRecord,
  VerificationChallengeRecord,
  VerificationEndpointRecord,
} from "@jobbbler/core-domain";

import { openSqliteDatabase } from "./connection.js";
import { createSqliteIdentityStore } from "./identity-repository.js";
import { migrateSqlite } from "./migrate.js";

const now = "2026-08-29T10:00:00.000Z";
const later = "2026-08-29T10:20:00.000Z";
const owner: OwnerIdentityRecord = {
  id: "own_00000000-0000-7000-8000-000000000001",
  kind: "ephemeral",
  verified: false,
  version: 0,
  createdAt: now,
  updatedAt: now,
};

function session(): OwnerSessionRecord {
  return {
    id: "ses_00000000-0000-7000-8000-000000000001",
    ownerId: owner.id,
    tokenHash: "session-hash-only",
    status: "active",
    expiresAt: "2026-08-29T10:10:00.000Z",
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function endpoint(
  id = "vep_00000000-0000-7000-8000-000000000001",
  addressHash = "email-address-hash-only",
): VerificationEndpointRecord {
  return {
    id,
    ownerId: owner.id,
    kind: "email",
    addressHash,
    addressCiphertext: "encrypted-email",
    maskedAddress: "p•••••@example.com",
    status: "pending",
    verifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function challenge(
  id = "vch_00000000-0000-7000-8000-000000000001",
  endpointId = endpoint().id,
  purpose: "owner_email_verification" | "search_alert_review" = "owner_email_verification",
): VerificationChallengeRecord {
  return {
    id,
    ownerId: owner.id,
    endpointId,
    purpose,
    tokenHash: `challenge-hash-${id}`,
    status: "pending",
    attempts: 0,
    maxAttempts: 2,
    expiresAt: "2026-08-29T10:10:00.000Z",
    consumedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function recoveryChallenge(): Omit<OwnerRecoveryChallengeRecord, "ownerId" | "endpointId"> {
  return {
    id: "recovery_00000000-0000-7000-8000-000000000001",
    tokenHash: "recovery-hash-only",
    status: "pending",
    attempts: 0,
    maxAttempts: 2,
    expiresAt: "2026-08-29T10:10:00.000Z",
    consumedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function deletionIntent(): OwnerDeletionIntentRecord {
  return {
    id: "deletion_00000000-0000-7000-8000-000000000001",
    ownerId: owner.id,
    status: "pending",
    expiresAt: "2026-08-29T10:05:00.000Z",
    createdAt: now,
    updatedAt: now,
  };
}

const databases: string[] = [];

function store() {
  const filename = join(tmpdir(), `jobbbler-identity-${crypto.randomUUID()}.sqlite`);
  databases.push(filename);
  const database = openSqliteDatabase(filename);
  migrateSqlite(database);
  return { database, store: createSqliteIdentityStore(database) };
}

afterEach(async () => {
  await Promise.all(
    databases
      .splice(0)
      .flatMap((filename) => [filename, `${filename}-shm`, `${filename}-wal`])
      .map((filename) => rm(filename, { force: true })),
  );
});

describe("SQLite identity persistence", () => {
  it("resumes the exact saga-bound alert challenge and rejects an identifier collision", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    const input = {
      endpoint: endpoint(),
      challenge: challenge(undefined, undefined, "search_alert_review"),
    };

    const first = await current.store.beginEmailVerification(input);

    await expect(current.store.beginEmailVerification(input)).resolves.toEqual(first);
    await expect(
      current.store.beginEmailVerification({
        ...input,
        challenge: { ...input.challenge, tokenHash: "different-token-hash" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    current.database.close();
  });

  it("rejects another alert review without resurrecting a revoked shared endpoint", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    const first = await current.store.beginEmailVerification({
      endpoint: endpoint(),
      challenge: challenge(undefined, undefined, "search_alert_review"),
    });
    await current.store.revokeVerificationEndpoint(owner.id, first.endpoint.id, later);

    await expect(
      current.store.beginEmailVerification({
        endpoint: endpoint("vep_00000000-0000-7000-8000-000000000002"),
        challenge: challenge(
          "vch_00000000-0000-7000-8000-000000000002",
          "vep_00000000-0000-7000-8000-000000000002",
          "search_alert_review",
        ),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      current.store.getVerificationEndpoint(owner.id, first.endpoint.id),
    ).resolves.toMatchObject({ status: "revoked" });
    expect(
      current.database
        .prepare("SELECT count(*) AS count FROM verification_challenges WHERE id = ?")
        .get("vch_00000000-0000-7000-8000-000000000002"),
    ).toEqual({ count: 0 });
    current.database.close();
  });

  it("rejects cross-owner session and verification relationships before writing", async () => {
    const current = store();

    await expect(
      current.store.createOwnerWithSession({
        owner,
        session: { ...session(), ownerId: "own_00000000-0000-7000-8000-000000000002" },
      }),
    ).rejects.toThrow("Owner session must belong to the owner being created.");
    expect(current.database.prepare("SELECT count(*) AS count FROM owners").get()).toEqual({
      count: 0,
    });

    await current.store.createOwnerWithSession({ owner, session: session() });
    await expect(
      current.store.beginEmailVerification({
        endpoint: endpoint(),
        challenge: { ...challenge(), ownerId: "own_00000000-0000-7000-8000-000000000002" },
      }),
    ).rejects.toThrow("Verification challenge and endpoint must belong to the same owner.");
    expect(
      current.database.prepare("SELECT count(*) AS count FROM verification_endpoints").get(),
    ).toEqual({ count: 0 });
    current.database.close();
  });

  it("creates owner and session atomically, then resolves only active unexpired sessions", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });

    await expect(current.store.resolveSession(session().tokenHash, now)).resolves.toMatchObject({
      owner,
      session: session(),
    });
    await expect(current.store.resolveSession(session().tokenHash, later)).resolves.toBeNull();
    expect(
      current.database.prepare("SELECT status FROM owner_sessions WHERE id = ?").get(session().id),
    ).toEqual({ status: "expired" });
    current.database.close();
  });

  it("replaces an active email challenge and upgrades an ephemeral owner after one successful consumption", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    const firstEndpoint = endpoint();
    const firstChallenge = challenge();
    await current.store.beginEmailVerification({
      endpoint: firstEndpoint,
      challenge: firstChallenge,
    });

    const replacement = await current.store.beginEmailVerification({
      endpoint: endpoint("vep_00000000-0000-7000-8000-000000000002"),
      challenge: challenge(
        "vch_00000000-0000-7000-8000-000000000002",
        "vep_00000000-0000-7000-8000-000000000002",
      ),
    });
    await expect(
      current.store.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: firstChallenge.id,
        tokenHash: firstChallenge.tokenHash,
        now,
      }),
    ).resolves.toEqual({ status: "expired" });

    await expect(
      current.store.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: replacement.challenge.id,
        tokenHash: replacement.challenge.tokenHash,
        now,
      }),
    ).resolves.toMatchObject({
      status: "verified",
      owner: { kind: "guest", verified: true, version: 1 },
      endpoint: { status: "verified", verifiedAt: now },
    });
    current.database.close();
  });

  it("confirms each search-alert challenge without mutating a previously verified shared endpoint", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    const first = await current.store.beginEmailVerification({
      endpoint: endpoint(),
      challenge: challenge(undefined, undefined, "search_alert_review"),
    });
    const verified = await current.store.consumeEmailVerification({
      ownerId: owner.id,
      challengeId: first.challenge.id,
      tokenHash: first.challenge.tokenHash,
      now,
      expectedPurpose: "search_alert_review",
      acceptConsumed: true,
    });
    expect(verified).toMatchObject({ status: "verified", owner: { version: 1 } });
    const verifiedEndpoint = await current.store.getVerificationEndpoint(
      owner.id,
      first.endpoint.id,
    );
    const replacementChallenge = challenge(
      "vch_00000000-0000-7000-8000-000000000002",
      "vep_00000000-0000-7000-8000-000000000002",
      "search_alert_review",
    );

    const replacement = await current.store.beginEmailVerification({
      endpoint: {
        ...endpoint("vep_00000000-0000-7000-8000-000000000002"),
        addressCiphertext: "different-encrypted-envelope",
        updatedAt: "2026-08-29T10:05:00.000Z",
      },
      challenge: {
        ...replacementChallenge,
        expiresAt: "2026-08-29T10:15:00.000Z",
        createdAt: "2026-08-29T10:05:00.000Z",
        updatedAt: "2026-08-29T10:05:00.000Z",
      },
    });

    expect(replacement.endpoint).toEqual(verifiedEndpoint);
    await expect(
      current.store.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: replacement.challenge.id,
        tokenHash: replacement.challenge.tokenHash,
        now: "2026-08-29T10:05:00.000Z",
        expectedPurpose: "search_alert_review",
        acceptConsumed: true,
      }),
    ).resolves.toMatchObject({
      status: "verified",
      owner: { version: 1 },
      endpoint: verifiedEndpoint,
    });
    const declined = await current.store.beginEmailVerification({
      endpoint: endpoint("vep_00000000-0000-7000-8000-000000000003"),
      challenge: challenge(
        "vch_00000000-0000-7000-8000-000000000003",
        "vep_00000000-0000-7000-8000-000000000003",
        "search_alert_review",
      ),
    });
    await expect(
      current.store.abandonEmailVerification({
        ownerId: owner.id,
        challengeId: declined.challenge.id,
        expectedPurpose: "search_alert_review",
        now,
      }),
    ).resolves.toBe(true);
    await expect(
      current.store.getVerificationEndpoint(owner.id, first.endpoint.id),
    ).resolves.toEqual(verifiedEndpoint);
    current.database.close();
  });

  it("keeps simultaneous search-alert review challenges independently consumable", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    const first = await current.store.beginEmailVerification({
      endpoint: endpoint(),
      challenge: challenge(undefined, undefined, "search_alert_review"),
    });
    const secondChallenge = challenge(
      "vch_00000000-0000-7000-8000-000000000002",
      "vep_00000000-0000-7000-8000-000000000002",
      "search_alert_review",
    );
    const second = await current.store.beginEmailVerification({
      endpoint: endpoint("vep_00000000-0000-7000-8000-000000000002"),
      challenge: secondChallenge,
    });

    await expect(
      current.store.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: first.challenge.id,
        tokenHash: first.challenge.tokenHash,
        now,
        expectedPurpose: "search_alert_review",
        acceptConsumed: true,
      }),
    ).resolves.toMatchObject({ status: "verified", endpoint: { id: first.endpoint.id } });
    await expect(
      current.store.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: second.challenge.id,
        tokenHash: second.challenge.tokenHash,
        now,
        expectedPurpose: "search_alert_review",
        acceptConsumed: true,
      }),
    ).resolves.toMatchObject({
      status: "verified",
      owner: { version: 1 },
      endpoint: { id: first.endpoint.id },
    });
    current.database.close();
  });

  it("abandons only the exact review challenge and removes its still-pending provisional endpoint", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    const started = await current.store.beginEmailVerification({
      endpoint: endpoint(),
      challenge: challenge(undefined, undefined, "search_alert_review"),
    });

    await expect(
      current.store.abandonEmailVerification({
        ownerId: owner.id,
        challengeId: started.challenge.id,
        expectedPurpose: "search_alert_review",
        now,
      }),
    ).resolves.toBe(true);
    expect(
      current.database.prepare("SELECT count(*) AS count FROM verification_challenges").get(),
    ).toEqual({ count: 0 });
    await expect(current.store.listVerificationEndpoints(owner.id)).resolves.toEqual([]);
    current.database.close();
  });

  it("purges expired review data within a bound while preserving unrelated verification state", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    const alert = await current.store.beginEmailVerification({
      endpoint: endpoint(),
      challenge: challenge(undefined, undefined, "search_alert_review"),
    });
    const unrelatedEndpoint = endpoint(
      "vep_00000000-0000-7000-8000-000000000009",
      "unrelated-email-address-hash",
    );
    const unrelatedChallenge = challenge(
      "vch_00000000-0000-7000-8000-000000000009",
      unrelatedEndpoint.id,
      "owner_email_verification",
    );
    await current.store.beginEmailVerification({
      endpoint: unrelatedEndpoint,
      challenge: unrelatedChallenge,
    });

    await expect(
      current.store.purgeExpiredEmailVerifications({
        purpose: "search_alert_review",
        now: later,
        limit: 1,
      }),
    ).resolves.toBe(1);
    expect(
      current.database.prepare("SELECT id FROM verification_challenges ORDER BY id").all(),
    ).toEqual([{ id: unrelatedChallenge.id }]);
    await expect(
      current.store.getVerificationEndpoint(owner.id, alert.endpoint.id),
    ).resolves.toBeNull();
    await expect(
      current.store.getVerificationEndpoint(owner.id, unrelatedEndpoint.id),
    ).resolves.toMatchObject({ id: unrelatedEndpoint.id, status: "pending" });
    current.database.close();
  });

  it("locks a challenge at its final invalid attempt without exposing a raw secret", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    const currentEndpoint = endpoint();
    const currentChallenge = challenge();
    await current.store.beginEmailVerification({
      endpoint: currentEndpoint,
      challenge: currentChallenge,
    });

    await expect(
      current.store.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: currentChallenge.id,
        tokenHash: "wrong",
        now,
      }),
    ).resolves.toEqual({ status: "invalid", remainingAttempts: 1 });
    await expect(
      current.store.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: currentChallenge.id,
        tokenHash: "wrong",
        now,
      }),
    ).resolves.toEqual({ status: "locked" });
    const definitions = current.database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name IN ('owner_sessions', 'verification_challenges')",
      )
      .all() as { sql: string }[];
    expect(definitions.map(({ sql }) => sql).join("\n")).not.toMatch(/raw_token|raw_code|secret/i);
    current.database.close();
  });

  it("lists, looks up, and revokes only the owner's verification endpoint", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    const stored = await current.store.beginEmailVerification({
      endpoint: endpoint(),
      challenge: challenge(),
    });
    current.database
      .prepare(
        `INSERT INTO saved_searches(id, owner_id, name, criteria_json, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "search_00000000-0000-7000-8000-000000000001",
        owner.id,
        "Test search",
        "{}",
        0,
        now,
        now,
      );
    current.database
      .prepare(
        `INSERT INTO schedules(
           id, owner_id, saved_search_id, recurrence_json, delivery_channel, delivery_endpoint_id,
           enabled, next_run_at, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "schedule_00000000-0000-7000-8000-000000000001",
        owner.id,
        "search_00000000-0000-7000-8000-000000000001",
        "{}",
        "email",
        stored.endpoint.id,
        1,
        later,
        4,
        now,
        now,
      );

    await expect(
      current.store.getVerificationEndpoint(owner.id, stored.endpoint.id),
    ).resolves.toEqual(stored.endpoint);
    await expect(
      current.store.getVerificationEndpoint("other-owner", stored.endpoint.id),
    ).resolves.toBeNull();
    await expect(current.store.listVerificationEndpoints(owner.id)).resolves.toEqual([
      stored.endpoint,
    ]);
    await expect(
      current.store.revokeVerificationEndpoint(owner.id, stored.endpoint.id, later),
    ).resolves.toMatchObject({ status: "revoked", verifiedAt: null, updatedAt: later });
    expect(
      current.database
        .prepare("SELECT enabled, version, updated_at FROM schedules WHERE id = ?")
        .get("schedule_00000000-0000-7000-8000-000000000001"),
    ).toEqual({ enabled: 0, version: 5, updated_at: later });
    await expect(
      current.store.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: stored.challenge.id,
        tokenHash: stored.challenge.tokenHash,
        now: later,
      }),
    ).resolves.toEqual({ status: "expired" });
    await expect(current.store.listVerificationEndpoints(owner.id)).resolves.toMatchObject([
      { id: stored.endpoint.id, status: "revoked" },
    ]);
    current.database.close();
  });

  it("issues recovery only for a verified endpoint and rotates every prior session atomically", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    const verified = await current.store.beginEmailVerification({
      endpoint: endpoint(),
      challenge: challenge(),
    });
    await current.store.consumeEmailVerification({
      ownerId: owner.id,
      challengeId: verified.challenge.id,
      tokenHash: verified.challenge.tokenHash,
      now,
    });

    await expect(
      current.store.beginOwnerRecovery({
        addressHash: "unknown-address-hash",
        challenge: recoveryChallenge(),
      }),
    ).resolves.toBeNull();
    const started = await current.store.beginOwnerRecovery({
      addressHash: endpoint().addressHash,
      challenge: recoveryChallenge(),
    });
    expect(started).toMatchObject({
      endpoint: { id: endpoint().id, status: "verified" },
      challenge: {
        id: recoveryChallenge().id,
        ownerId: owner.id,
        endpointId: endpoint().id,
        tokenHash: "recovery-hash-only",
      },
    });

    const newSession = {
      ...session(),
      id: "ses_00000000-0000-7000-8000-000000000002",
      tokenHash: "new-session-hash-only",
      expiresAt: "2026-09-05T10:00:00.000Z",
    };
    const { ownerId: _ownerId, ...unboundSession } = newSession;
    await expect(
      current.store.consumeOwnerRecovery({
        challengeId: recoveryChallenge().id,
        tokenHash: recoveryChallenge().tokenHash,
        session: unboundSession,
        now,
      }),
    ).resolves.toMatchObject({
      status: "recovered",
      owner: { id: owner.id, verified: true },
      session: { id: newSession.id, ownerId: owner.id, status: "active" },
    });
    expect(
      current.database
        .prepare("SELECT id, status, token_hash FROM owner_sessions ORDER BY id")
        .all(),
    ).toEqual([
      { id: session().id, status: "revoked", token_hash: session().tokenHash },
      { id: newSession.id, status: "active", token_hash: newSession.tokenHash },
    ]);
    await expect(
      current.store.consumeOwnerRecovery({
        challengeId: recoveryChallenge().id,
        tokenHash: recoveryChallenge().tokenHash,
        session: { ...unboundSession, id: "ses_00000000-0000-7000-8000-000000000003" },
        now,
      }),
    ).resolves.toEqual({ status: "consumed" });
    current.database.close();
  });

  it("deletes all owner private data transactionally and scrubs retained audit facts", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    await current.store.beginOwnerDeletion(deletionIntent());
    const sql = current.database;
    sql
      .prepare(
        "INSERT INTO organizations(id,name,slug,website,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run("org_public", "Public Org", "public-org", null, "Public", now, now);
    sql
      .prepare(
        `INSERT INTO jobs(id,organization_id,organization_name,title,summary,categories_json,
        work_model,employment_type,seniority,locations_json,skills_json,source_key,source_label,
        source_url,apply_mode,status,published_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "job_public",
        "org_public",
        "Public Org",
        "Engineer",
        "Public role",
        "[]",
        "remote",
        "full_time",
        null,
        "[]",
        "[]",
        "jobbbler_demo",
        "Jobbbler demo",
        null,
        "internal",
        "open",
        now,
        now,
      );
    sql
      .prepare(
        "INSERT INTO saved_searches(id,owner_id,name,criteria_json,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run("search_private", owner.id, "Private search", "{}", 0, now, now);
    sql
      .prepare(
        `INSERT INTO application_drafts(id,owner_id,job_id,state,version,answers_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run("draft_private", owner.id, "job_public", "reviewed", 1, '{"name":"Private"}', now, now);
    sql
      .prepare(
        `INSERT INTO application_review_records(id,owner_id,draft_id,draft_version,payload_hash,
       findings_json,status,created_at,invalidated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run("review_private", owner.id, "draft_private", 1, "payload", "[]", "active", now, null);
    sql
      .prepare(
        `INSERT INTO application_confirmation_records(id,owner_id,draft_id,review_id,payload_hash,
       confirmation_hash,status,expires_at,created_at,consumed_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "confirmation_private",
        owner.id,
        "draft_private",
        "review_private",
        "payload",
        "hash",
        "active",
        later,
        now,
        null,
      );
    const submittedFields = JSON.stringify([
      {
        fieldKey: "full_name",
        label: "Full name",
        value: "Private candidate",
        sensitive: true,
      },
    ]);
    const submittedSnapshot = JSON.stringify({
      managedDeliveryId: "managed_delivery_private",
      provider: "jobbbler_demo",
      providerReferenceId: "demo_submission_private",
      recipientId: "org_public",
      recipientName: "Public Org",
      submittedAt: now,
      fields: JSON.parse(submittedFields),
    });
    sql
      .prepare(
        `INSERT INTO managed_application_deliveries(
          id,owner_id,draft_id,review_id,confirmation_id,idempotency_key,provider,
          provider_reference_id,recipient_id,recipient_name,payload_hash,fields_json,status,
          acknowledged_at,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "managed_delivery_private",
        owner.id,
        "draft_private",
        "review_private",
        "confirmation_private",
        "idempotency",
        "jobbbler_demo",
        "demo_submission_private",
        "org_public",
        "Public Org",
        "payload",
        submittedFields,
        "acknowledged",
        now,
        now,
      );
    sql
      .prepare(
        "UPDATE application_confirmation_records SET status='consumed', consumed_at=? WHERE id=?",
      )
      .run(now, "confirmation_private");
    sql
      .prepare(
        `INSERT INTO application_submission_receipts(id,owner_id,draft_id,review_id,confirmation_id,
       idempotency_key,status,external_url,created_at,submission_json) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "receipt_private",
        owner.id,
        "draft_private",
        "review_private",
        "confirmation_private",
        "idempotency",
        "submitted",
        null,
        now,
        submittedSnapshot,
      );
    sql
      .prepare(
        `INSERT INTO audit_events(id,type,actor_kind,actor_id,aggregate_type,aggregate_id,
       correlation_id,safe_metadata_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "audit_private",
        "application.updated",
        "human",
        owner.id,
        "application_draft",
        "draft_private",
        "correlation_private",
        '{"candidate":"Private"}',
        now,
      );

    await expect(
      current.store.deleteOwnerPrivateData({
        ownerId: owner.id,
        sessionId: session().id,
        deletionId: deletionIntent().id,
        now,
      }),
    ).resolves.toBe(true);
    for (const table of [
      "owners",
      "owner_sessions",
      "owner_deletion_intents",
      "saved_searches",
      "application_drafts",
      "application_submission_receipts",
      "managed_application_deliveries",
    ]) {
      expect(sql.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    expect(sql.prepare("SELECT count(*) AS count FROM jobs").get()).toEqual({ count: 1 });
    expect(
      sql.prepare("SELECT * FROM audit_events WHERE id = ?").get("audit_private"),
    ).toMatchObject({
      actor_id: null,
      aggregate_id: "deleted",
      correlation_id: "deleted",
      safe_metadata_json: '{"redacted":true}',
    });
    current.database.close();
  });

  it("keeps owner data when the deletion intent is expired or belongs to another session", async () => {
    const current = store();
    await current.store.createOwnerWithSession({ owner, session: session() });
    await current.store.beginOwnerDeletion(deletionIntent());

    await expect(
      current.store.deleteOwnerPrivateData({
        ownerId: owner.id,
        sessionId: "ses_00000000-0000-7000-8000-000000000099",
        deletionId: deletionIntent().id,
        now,
      }),
    ).resolves.toBe(false);
    await expect(
      current.store.deleteOwnerPrivateData({
        ownerId: owner.id,
        sessionId: session().id,
        deletionId: deletionIntent().id,
        now: later,
      }),
    ).resolves.toBe(false);
    expect(current.database.prepare("SELECT count(*) AS count FROM owners").get()).toEqual({
      count: 1,
    });
    current.database.close();
  });
});
