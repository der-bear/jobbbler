import type {
  ConsumeOwnerRecoveryResult,
  ConsumeVerificationResult,
  IdentityStore,
  OwnerDeletionIntentRecord,
  OwnerIdentityRecord,
  OwnerRecoveryChallengeRecord,
  OwnerSessionRecord,
  ResolvedOwnerSession,
  VerificationChallengeRecord,
  VerificationEndpointRecord,
} from "@jobbbler/core-domain";
import { DomainError } from "@jobbbler/core-domain";

import type { SqliteDatabase } from "./connection.js";

interface OwnerRow {
  readonly id: string;
  readonly kind: OwnerIdentityRecord["kind"];
  readonly verified: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface SessionRow {
  readonly id: string;
  readonly owner_id: string;
  readonly token_hash: string;
  readonly status: OwnerSessionRecord["status"];
  readonly expires_at: string;
  readonly last_seen_at: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface EndpointRow {
  readonly id: string;
  readonly owner_id: string;
  readonly kind: VerificationEndpointRecord["kind"];
  readonly address_hash: string;
  readonly address_ciphertext: string;
  readonly masked_address: string;
  readonly status: VerificationEndpointRecord["status"];
  readonly verified_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ChallengeRow {
  readonly id: string;
  readonly owner_id: string;
  readonly endpoint_id: string;
  readonly purpose: NonNullable<VerificationChallengeRecord["purpose"]>;
  readonly token_hash: string;
  readonly status: VerificationChallengeRecord["status"];
  readonly attempts: number;
  readonly max_attempts: number;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface RecoveryChallengeRow {
  readonly id: string;
  readonly owner_id: string;
  readonly endpoint_id: string;
  readonly token_hash: string;
  readonly status: OwnerRecoveryChallengeRecord["status"];
  readonly attempts: number;
  readonly max_attempts: number;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function ownerFromRow(row: OwnerRow): OwnerIdentityRecord {
  return {
    id: row.id,
    kind: row.kind,
    verified: row.verified === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sessionFromRow(row: SessionRow): OwnerSessionRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    tokenHash: row.token_hash,
    status: row.status,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function endpointFromRow(row: EndpointRow): VerificationEndpointRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    addressHash: row.address_hash,
    addressCiphertext: row.address_ciphertext,
    maskedAddress: row.masked_address,
    status: row.status,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function challengeFromRow(row: ChallengeRow): VerificationChallengeRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    endpointId: row.endpoint_id,
    purpose: row.purpose,
    tokenHash: row.token_hash,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function recoveryChallengeFromRow(row: RecoveryChallengeRow): OwnerRecoveryChallengeRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    endpointId: row.endpoint_id,
    tokenHash: row.token_hash,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deletePendingOrphanEndpoint(
  database: SqliteDatabase,
  ownerId: string,
  endpointId: string,
): void {
  database
    .prepare(
      `DELETE FROM verification_endpoints
       WHERE id = ?
         AND owner_id = ?
         AND status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM verification_challenges WHERE endpoint_id = verification_endpoints.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM owner_recovery_challenges WHERE endpoint_id = verification_endpoints.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM schedules WHERE delivery_endpoint_id = verification_endpoints.id
         )`,
    )
    .run(endpointId, ownerId);
}

export function createSqliteIdentityStore(database: SqliteDatabase): IdentityStore {
  return {
    async createOwnerWithSession(input): Promise<ResolvedOwnerSession> {
      if (input.owner.id !== input.session.ownerId) {
        throw new TypeError("Owner session must belong to the owner being created.");
      }
      const create = database.transaction(() => {
        database
          .prepare(
            `INSERT INTO owners(id, kind, verified, version, created_at, updated_at)
             VALUES (@id, @kind, @verified, @version, @createdAt, @updatedAt)`,
          )
          .run({ ...input.owner, verified: input.owner.verified ? 1 : 0 });
        database
          .prepare(
            `INSERT INTO owner_sessions(
               id, owner_id, token_hash, status, expires_at, last_seen_at, created_at, updated_at
             ) VALUES (
               @id, @ownerId, @tokenHash, @status, @expiresAt, @lastSeenAt, @createdAt, @updatedAt
             )`,
          )
          .run(input.session);
        return { owner: input.owner, session: input.session };
      });
      return create.immediate();
    },

    async resolveSession(tokenHash, now): Promise<ResolvedOwnerSession | null> {
      const resolve = database.transaction(() => {
        database
          .prepare(
            `UPDATE owner_sessions
             SET status = 'expired', updated_at = ?
             WHERE token_hash = ? AND status = 'active' AND expires_at <= ?`,
          )
          .run(now, tokenHash, now);
        const row = database
          .prepare(
            `SELECT
               o.id AS owner_id, o.kind AS owner_kind, o.verified AS owner_verified,
               o.version AS owner_version, o.created_at AS owner_created_at, o.updated_at AS owner_updated_at,
               s.id AS session_id, s.owner_id AS session_owner_id, s.token_hash AS session_token_hash,
               s.status AS session_status, s.expires_at AS session_expires_at, s.last_seen_at AS session_last_seen_at,
               s.created_at AS session_created_at, s.updated_at AS session_updated_at
             FROM owner_sessions s JOIN owners o ON o.id = s.owner_id
             WHERE s.token_hash = ? AND s.status = 'active' AND s.expires_at > ?`,
          )
          .get(tokenHash, now) as
          | {
              readonly owner_id: string;
              readonly owner_kind: OwnerIdentityRecord["kind"];
              readonly owner_verified: number;
              readonly owner_version: number;
              readonly owner_created_at: string;
              readonly owner_updated_at: string;
              readonly session_id: string;
              readonly session_owner_id: string;
              readonly session_token_hash: string;
              readonly session_status: OwnerSessionRecord["status"];
              readonly session_expires_at: string;
              readonly session_last_seen_at: string;
              readonly session_created_at: string;
              readonly session_updated_at: string;
            }
          | undefined;
        if (row === undefined) return null;
        database
          .prepare("UPDATE owner_sessions SET last_seen_at = ?, updated_at = ? WHERE id = ?")
          .run(now, now, row.session_id);
        return {
          owner: ownerFromRow({
            id: row.owner_id,
            kind: row.owner_kind,
            verified: row.owner_verified,
            version: row.owner_version,
            created_at: row.owner_created_at,
            updated_at: row.owner_updated_at,
          }),
          session: sessionFromRow({
            id: row.session_id,
            owner_id: row.session_owner_id,
            token_hash: row.session_token_hash,
            status: row.session_status,
            expires_at: row.session_expires_at,
            last_seen_at: now,
            created_at: row.session_created_at,
            updated_at: now,
          }),
        };
      });
      return resolve.immediate();
    },

    async beginEmailVerification(input) {
      if (input.endpoint.ownerId !== input.challenge.ownerId) {
        throw new TypeError("Verification challenge and endpoint must belong to the same owner.");
      }
      const begin = database.transaction(() => {
        const purpose = input.challenge.purpose ?? "owner_email_verification";
        const existingChallenge = database
          .prepare("SELECT * FROM verification_challenges WHERE id = ?")
          .get(input.challenge.id) as ChallengeRow | undefined;
        if (existingChallenge !== undefined) {
          const existingEndpoint = database
            .prepare("SELECT * FROM verification_endpoints WHERE id = ? AND owner_id = ?")
            .get(existingChallenge.endpoint_id, input.endpoint.ownerId) as EndpointRow | undefined;
          const exact =
            existingEndpoint !== undefined &&
            existingEndpoint.kind === input.endpoint.kind &&
            existingEndpoint.address_hash === input.endpoint.addressHash &&
            existingChallenge.owner_id === input.challenge.ownerId &&
            existingChallenge.purpose === purpose &&
            existingChallenge.token_hash === input.challenge.tokenHash &&
            existingChallenge.max_attempts === input.challenge.maxAttempts &&
            existingChallenge.expires_at === input.challenge.expiresAt &&
            existingChallenge.created_at === input.challenge.createdAt;
          if (!exact) {
            throw new DomainError({
              code: "CONFLICT",
              message: "The verification challenge identifier is already bound to different data.",
            });
          }
          const endpoint = endpointFromRow(existingEndpoint);
          if (purpose === "search_alert_review" && endpoint.status === "revoked") {
            throw new DomainError({
              code: "CONFLICT",
              message: "This delivery address is revoked and cannot be used for search alerts.",
              details: { reason: "revoked_destination" },
            });
          }
          return {
            endpoint,
            challenge: challengeFromRow(existingChallenge),
          };
        }
        database
          .prepare(
            `INSERT INTO verification_endpoints(
               id, owner_id, kind, address_hash, address_ciphertext, masked_address,
               status, verified_at, created_at, updated_at
             ) VALUES (
               @id, @ownerId, @kind, @addressHash, @addressCiphertext, @maskedAddress,
               @status, @verifiedAt, @createdAt, @updatedAt
             ) ON CONFLICT(owner_id, kind, address_hash) DO UPDATE SET
               address_ciphertext = CASE
                 WHEN verification_endpoints.status IN ('verified', 'revoked')
                   THEN verification_endpoints.address_ciphertext
                 ELSE excluded.address_ciphertext
               END,
               masked_address = CASE
                 WHEN verification_endpoints.status IN ('verified', 'revoked')
                   THEN verification_endpoints.masked_address
                 ELSE excluded.masked_address
               END,
               status = CASE
                 WHEN verification_endpoints.status IN ('verified', 'revoked')
                   THEN verification_endpoints.status
                 ELSE 'pending'
               END,
               verified_at = CASE
                 WHEN verification_endpoints.status IN ('verified', 'revoked')
                   THEN verification_endpoints.verified_at
                 ELSE NULL
               END,
               updated_at = CASE
                 WHEN verification_endpoints.status IN ('verified', 'revoked')
                   THEN verification_endpoints.updated_at
                 ELSE excluded.updated_at
               END`,
          )
          .run(input.endpoint);
        const endpoint = database
          .prepare(
            `SELECT * FROM verification_endpoints
             WHERE owner_id = ? AND kind = ? AND address_hash = ?`,
          )
          .get(
            input.endpoint.ownerId,
            input.endpoint.kind,
            input.endpoint.addressHash,
          ) as EndpointRow;
        if (purpose === "search_alert_review" && endpoint.status === "revoked") {
          throw new DomainError({
            code: "CONFLICT",
            message: "This delivery address is revoked and cannot be used for search alerts.",
            details: { reason: "revoked_destination" },
          });
        }
        if (purpose === "owner_email_verification") {
          database
            .prepare(
              `UPDATE verification_challenges
               SET status = 'expired', updated_at = ?
               WHERE owner_id = ? AND purpose = ? AND status = 'pending'`,
            )
            .run(input.challenge.updatedAt, input.challenge.ownerId, purpose);
        }
        database
          .prepare(
            `INSERT INTO verification_challenges(
               id, owner_id, endpoint_id, purpose, token_hash, status, attempts, max_attempts,
               expires_at, consumed_at, created_at, updated_at
             ) VALUES (
               @id, @ownerId, @endpointId, @purpose, @tokenHash, @status, @attempts, @maxAttempts,
               @expiresAt, @consumedAt, @createdAt, @updatedAt
             )`,
          )
          .run({ ...input.challenge, endpointId: endpoint.id, purpose });
        const challenge = database
          .prepare("SELECT * FROM verification_challenges WHERE id = ?")
          .get(input.challenge.id) as ChallengeRow;
        return { endpoint: endpointFromRow(endpoint), challenge: challengeFromRow(challenge) };
      });
      return begin.immediate();
    },

    async consumeEmailVerification(input): Promise<ConsumeVerificationResult> {
      const consume = database.transaction(() => {
        const challenge = database
          .prepare("SELECT * FROM verification_challenges WHERE id = ? AND owner_id = ?")
          .get(input.challengeId, input.ownerId) as ChallengeRow | undefined;
        if (challenge === undefined) return { status: "invalid", remainingAttempts: 0 } as const;
        if (input.expectedPurpose !== undefined && challenge.purpose !== input.expectedPurpose) {
          return { status: "invalid", remainingAttempts: 0 } as const;
        }
        if (challenge.status === "consumed") {
          if (input.acceptConsumed !== true) return { status: "consumed" } as const;
          if (challenge.token_hash !== input.tokenHash) {
            return { status: "invalid", remainingAttempts: 0 } as const;
          }
          const consumedOwner = database
            .prepare("SELECT * FROM owners WHERE id = ?")
            .get(input.ownerId) as OwnerRow | undefined;
          const consumedEndpoint = database
            .prepare("SELECT * FROM verification_endpoints WHERE id = ? AND owner_id = ?")
            .get(challenge.endpoint_id, input.ownerId) as EndpointRow | undefined;
          if (
            consumedOwner === undefined ||
            consumedEndpoint === undefined ||
            consumedEndpoint.status !== "verified"
          ) {
            return { status: "consumed" } as const;
          }
          return {
            status: "verified",
            owner: ownerFromRow(consumedOwner),
            endpoint: endpointFromRow(consumedEndpoint),
          } as const;
        }
        if (challenge.status === "locked" || challenge.status === "expired") {
          return { status: challenge.status };
        }
        if (challenge.expires_at <= input.now) {
          database
            .prepare(
              "UPDATE verification_challenges SET status = 'expired', updated_at = ? WHERE id = ?",
            )
            .run(input.now, challenge.id);
          return { status: "expired" } as const;
        }
        if (challenge.token_hash !== input.tokenHash) {
          const attempts = challenge.attempts + 1;
          if (attempts >= challenge.max_attempts) {
            database
              .prepare(
                "UPDATE verification_challenges SET attempts = ?, status = 'locked', updated_at = ? WHERE id = ?",
              )
              .run(attempts, input.now, challenge.id);
            return { status: "locked" } as const;
          }
          database
            .prepare("UPDATE verification_challenges SET attempts = ?, updated_at = ? WHERE id = ?")
            .run(attempts, input.now, challenge.id);
          return {
            status: "invalid",
            remainingAttempts: challenge.max_attempts - attempts,
          } as const;
        }
        const currentOwner = database
          .prepare("SELECT * FROM owners WHERE id = ?")
          .get(input.ownerId) as OwnerRow | undefined;
        const currentEndpoint = database
          .prepare("SELECT * FROM verification_endpoints WHERE id = ? AND owner_id = ?")
          .get(challenge.endpoint_id, input.ownerId) as EndpointRow | undefined;
        if (currentOwner === undefined || currentEndpoint === undefined) {
          return { status: "invalid", remainingAttempts: 0 } as const;
        }
        database
          .prepare(
            `UPDATE verification_challenges
             SET status = 'consumed', consumed_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(input.now, input.now, challenge.id);
        if (currentEndpoint.status !== "verified") {
          database
            .prepare(
              `UPDATE verification_endpoints
               SET status = 'verified', verified_at = ?, updated_at = ? WHERE id = ?`,
            )
            .run(input.now, input.now, challenge.endpoint_id);
        }
        if (currentOwner.verified !== 1) {
          database
            .prepare(
              `UPDATE owners
               SET kind = CASE WHEN kind = 'ephemeral' THEN 'guest' ELSE kind END,
                   verified = 1,
                   version = version + 1,
                   updated_at = ?
               WHERE id = ?`,
            )
            .run(input.now, input.ownerId);
        }
        const owner = database
          .prepare("SELECT * FROM owners WHERE id = ?")
          .get(input.ownerId) as OwnerRow;
        const endpoint = database
          .prepare("SELECT * FROM verification_endpoints WHERE id = ?")
          .get(challenge.endpoint_id) as EndpointRow;
        return {
          status: "verified",
          owner: ownerFromRow(owner),
          endpoint: endpointFromRow(endpoint),
        } as const;
      });
      return consume.immediate();
    },

    async abandonEmailVerification(input): Promise<boolean> {
      const abandon = database.transaction(() => {
        const challenge = database
          .prepare(
            `SELECT * FROM verification_challenges
             WHERE id = ? AND owner_id = ? AND purpose = ?`,
          )
          .get(input.challengeId, input.ownerId, input.expectedPurpose) as ChallengeRow | undefined;
        if (challenge === undefined) return false;
        database.prepare("DELETE FROM verification_challenges WHERE id = ?").run(challenge.id);
        deletePendingOrphanEndpoint(database, input.ownerId, challenge.endpoint_id);
        return true;
      });
      return abandon.immediate();
    },

    async purgeExpiredEmailVerifications(input): Promise<number> {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
        throw new TypeError("Verification retention limit must be between 1 and 1000.");
      }
      const purge = database.transaction(() => {
        const expired = database
          .prepare(
            `SELECT * FROM verification_challenges
             WHERE purpose = ? AND expires_at <= ?
             ORDER BY expires_at, id
             LIMIT ?`,
          )
          .all(input.purpose, input.now, input.limit) as ChallengeRow[];
        for (const challenge of expired) {
          database.prepare("DELETE FROM verification_challenges WHERE id = ?").run(challenge.id);
          deletePendingOrphanEndpoint(database, challenge.owner_id, challenge.endpoint_id);
        }
        return expired.length;
      });
      return purge.immediate();
    },

    async getVerificationEndpoint(ownerId, endpointId): Promise<VerificationEndpointRecord | null> {
      const row = database
        .prepare("SELECT * FROM verification_endpoints WHERE owner_id = ? AND id = ?")
        .get(ownerId, endpointId) as EndpointRow | undefined;
      return row === undefined ? null : endpointFromRow(row);
    },

    async listVerificationEndpoints(ownerId): Promise<VerificationEndpointRecord[]> {
      const rows = database
        .prepare(
          "SELECT * FROM verification_endpoints WHERE owner_id = ? ORDER BY updated_at DESC, id",
        )
        .all(ownerId) as EndpointRow[];
      return rows.map(endpointFromRow);
    },

    async revokeVerificationEndpoint(
      ownerId,
      endpointId,
      now,
    ): Promise<VerificationEndpointRecord | null> {
      const revoke = database.transaction(() => {
        const result = database
          .prepare(
            `UPDATE verification_endpoints
             SET status = 'revoked', verified_at = NULL, updated_at = ?
             WHERE owner_id = ? AND id = ? AND status <> 'revoked'`,
          )
          .run(now, ownerId, endpointId);
        if (result.changes === 0) {
          const existing = database
            .prepare("SELECT * FROM verification_endpoints WHERE owner_id = ? AND id = ?")
            .get(ownerId, endpointId) as EndpointRow | undefined;
          return existing === undefined ? null : endpointFromRow(existing);
        }
        database
          .prepare(
            `UPDATE verification_challenges
             SET status = 'expired', updated_at = ?
             WHERE endpoint_id = ? AND status = 'pending'`,
          )
          .run(now, endpointId);
        database
          .prepare(
            `UPDATE owner_recovery_challenges
             SET status = 'expired', updated_at = ?
             WHERE endpoint_id = ? AND status = 'pending'`,
          )
          .run(now, endpointId);
        database
          .prepare(
            `UPDATE schedules
             SET enabled = 0,
                 version = version + 1,
                 updated_at = ?
             WHERE owner_id = ?
               AND delivery_endpoint_id = ?
               AND enabled = 1`,
          )
          .run(now, ownerId, endpointId);
        const row = database
          .prepare("SELECT * FROM verification_endpoints WHERE id = ?")
          .get(endpointId) as EndpointRow;
        return endpointFromRow(row);
      });
      return revoke.immediate();
    },

    async beginOwnerRecovery(input) {
      const begin = database.transaction(() => {
        const endpoint = database
          .prepare(
            `SELECT * FROM verification_endpoints
             WHERE address_hash = ? AND status = 'verified'`,
          )
          .get(input.addressHash) as EndpointRow | undefined;
        if (endpoint === undefined) return null;
        database
          .prepare(
            `UPDATE owner_recovery_challenges
             SET status = 'expired', updated_at = ?
             WHERE owner_id = ? AND status = 'pending'`,
          )
          .run(input.challenge.updatedAt, endpoint.owner_id);
        database
          .prepare(
            `INSERT INTO owner_recovery_challenges(
               id, owner_id, endpoint_id, token_hash, status, attempts, max_attempts,
               expires_at, consumed_at, created_at, updated_at
             ) VALUES (
               @id, @ownerId, @endpointId, @tokenHash, @status, @attempts, @maxAttempts,
               @expiresAt, @consumedAt, @createdAt, @updatedAt
             )`,
          )
          .run({ ...input.challenge, ownerId: endpoint.owner_id, endpointId: endpoint.id });
        const challenge = database
          .prepare("SELECT * FROM owner_recovery_challenges WHERE id = ?")
          .get(input.challenge.id) as RecoveryChallengeRow;
        return {
          endpoint: endpointFromRow(endpoint),
          challenge: recoveryChallengeFromRow(challenge),
        };
      });
      return begin.immediate();
    },

    async consumeOwnerRecovery(input): Promise<ConsumeOwnerRecoveryResult> {
      const consume = database.transaction(() => {
        const challenge = database
          .prepare("SELECT * FROM owner_recovery_challenges WHERE id = ?")
          .get(input.challengeId) as RecoveryChallengeRow | undefined;
        if (challenge === undefined) return { status: "invalid" } as const;
        if (challenge.status !== "pending") return { status: challenge.status } as const;
        if (challenge.expires_at <= input.now) {
          database
            .prepare(
              "UPDATE owner_recovery_challenges SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'",
            )
            .run(input.now, challenge.id);
          return { status: "expired" } as const;
        }
        if (challenge.token_hash !== input.tokenHash) {
          const attempts = challenge.attempts + 1;
          const locked = attempts >= challenge.max_attempts;
          database
            .prepare(
              `UPDATE owner_recovery_challenges
               SET attempts = ?, status = ?, updated_at = ?
               WHERE id = ? AND status = 'pending' AND attempts = ?`,
            )
            .run(
              attempts,
              locked ? "locked" : "pending",
              input.now,
              challenge.id,
              challenge.attempts,
            );
          return { status: locked ? "locked" : "invalid" } as const;
        }
        const endpoint = database
          .prepare(
            `SELECT * FROM verification_endpoints
             WHERE id = ? AND owner_id = ? AND status = 'verified'`,
          )
          .get(challenge.endpoint_id, challenge.owner_id) as EndpointRow | undefined;
        const ownerRow = database
          .prepare("SELECT * FROM owners WHERE id = ? AND verified = 1")
          .get(challenge.owner_id) as OwnerRow | undefined;
        if (endpoint === undefined || ownerRow === undefined) return { status: "invalid" } as const;
        database
          .prepare(
            `UPDATE owner_recovery_challenges
             SET status = 'consumed', consumed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(input.now, input.now, challenge.id);
        database
          .prepare(
            `UPDATE owner_sessions SET status = 'revoked', updated_at = ?
             WHERE owner_id = ? AND status = 'active'`,
          )
          .run(input.now, challenge.owner_id);
        const session: OwnerSessionRecord = { ...input.session, ownerId: challenge.owner_id };
        database
          .prepare(
            `INSERT INTO owner_sessions(
               id, owner_id, token_hash, status, expires_at, last_seen_at, created_at, updated_at
             ) VALUES (
               @id, @ownerId, @tokenHash, @status, @expiresAt, @lastSeenAt, @createdAt, @updatedAt
             )`,
          )
          .run(session);
        return { status: "recovered", owner: ownerFromRow(ownerRow), session } as const;
      });
      return consume.immediate();
    },

    async beginOwnerDeletion(intent: OwnerDeletionIntentRecord) {
      const begin = database.transaction(() => {
        database
          .prepare(
            `UPDATE owner_deletion_intents SET status = 'expired', updated_at = ?
             WHERE owner_id = ? AND status = 'pending'`,
          )
          .run(intent.updatedAt, intent.ownerId);
        database
          .prepare(
            `INSERT INTO owner_deletion_intents(
               id, owner_id, status, expires_at, created_at, updated_at
             ) VALUES (@id, @ownerId, @status, @expiresAt, @createdAt, @updatedAt)`,
          )
          .run(intent);
        return intent;
      });
      return begin.immediate();
    },

    async deleteOwnerPrivateData(input) {
      const remove = database.transaction(() => {
        const authorized = database
          .prepare(
            `SELECT 1 AS present
             FROM owner_deletion_intents AS intent
             JOIN owner_sessions AS session ON session.owner_id = intent.owner_id
             WHERE intent.id = ? AND intent.owner_id = ? AND intent.status = 'pending'
               AND intent.expires_at > ? AND session.id = ? AND session.status = 'active'
               AND session.expires_at > ?`,
          )
          .get(input.deletionId, input.ownerId, input.now, input.sessionId, input.now) as
          { readonly present: number } | undefined;
        if (authorized === undefined) {
          database
            .prepare(
              `UPDATE owner_deletion_intents SET status = 'expired', updated_at = ?
               WHERE id = ? AND owner_id = ? AND status = 'pending' AND expires_at <= ?`,
            )
            .run(input.now, input.deletionId, input.ownerId, input.now);
          return false;
        }
        const privatePattern = `%${input.ownerId}%`;
        database
          .prepare(
            `UPDATE audit_events
             SET actor_id = NULL,
                 aggregate_id = 'deleted',
                 correlation_id = 'deleted',
                 safe_metadata_json = '{"redacted":true}'
             WHERE actor_id = ?
                OR safe_metadata_json LIKE ?
                OR aggregate_id IN (SELECT id FROM saved_searches WHERE owner_id = ?)
                OR aggregate_id IN (SELECT id FROM schedules WHERE owner_id = ?)
                OR aggregate_id IN (SELECT id FROM application_drafts WHERE owner_id = ?)
                OR aggregate_id IN (SELECT id FROM verification_endpoints WHERE owner_id = ?)`,
          )
          .run(
            input.ownerId,
            privatePattern,
            input.ownerId,
            input.ownerId,
            input.ownerId,
            input.ownerId,
          );
        database
          .prepare(
            `DELETE FROM work_items
             WHERE payload_json LIKE ?
                OR json_extract(payload_json, '$.deliveryId') IN (
                  SELECT id FROM notification_deliveries WHERE owner_id = ?
                )`,
          )
          .run(privatePattern, input.ownerId);
        database
          .prepare(
            `DELETE FROM outbox_events
             WHERE payload_json LIKE ?
                OR aggregate_id IN (SELECT id FROM saved_searches WHERE owner_id = ?)
                OR aggregate_id IN (SELECT id FROM schedules WHERE owner_id = ?)
                OR aggregate_id IN (SELECT id FROM application_drafts WHERE owner_id = ?)`,
          )
          .run(privatePattern, input.ownerId, input.ownerId, input.ownerId);
        database
          .prepare(
            `DELETE FROM idempotency_records
             WHERE scope LIKE ? OR response_body_json LIKE ?`,
          )
          .run(privatePattern, privatePattern);
        database
          .prepare(
            `DELETE FROM search_runs
             WHERE saved_search_id IN (SELECT id FROM saved_searches WHERE owner_id = ?)`,
          )
          .run(input.ownerId);
        database
          .prepare(`DELETE FROM application_submission_receipts WHERE owner_id = ?`)
          .run(input.ownerId);
        database
          .prepare(
            `DELETE FROM application_submissions
             WHERE draft_id IN (SELECT id FROM application_drafts WHERE owner_id = ?)`,
          )
          .run(input.ownerId);
        const deleted = database.prepare("DELETE FROM owners WHERE id = ?").run(input.ownerId);
        return deleted.changes === 1;
      });
      return remove.immediate();
    },
  };
}
