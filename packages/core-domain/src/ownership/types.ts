import type { OwnerKind } from "@jobbbler/contracts";

export interface OwnerIdentityRecord {
  readonly id: string;
  readonly kind: OwnerKind;
  readonly verified: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OwnerSessionRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly tokenHash: string;
  readonly status: "active" | "revoked" | "expired";
  readonly expiresAt: string;
  readonly lastSeenAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VerificationEndpointRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly kind: "email";
  readonly addressHash: string;
  readonly addressCiphertext: string;
  readonly maskedAddress: string;
  readonly status: "pending" | "verified" | "revoked";
  readonly verifiedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VerificationChallengeRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly endpointId: string;
  readonly tokenHash: string;
  readonly status: "pending" | "consumed" | "expired" | "locked";
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OwnerRecoveryChallengeRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly endpointId: string;
  readonly tokenHash: string;
  readonly status: "pending" | "consumed" | "expired" | "locked";
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OwnerDeletionIntentRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly status: "pending" | "expired";
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResolvedOwnerSession {
  readonly owner: OwnerIdentityRecord;
  readonly session: OwnerSessionRecord;
}

export type ConsumeVerificationResult =
  | {
      readonly status: "verified";
      readonly owner: OwnerIdentityRecord;
      readonly endpoint: VerificationEndpointRecord;
    }
  | { readonly status: "invalid"; readonly remainingAttempts: number }
  | { readonly status: "expired" | "locked" | "consumed" };

export type ConsumeOwnerRecoveryResult =
  | {
      readonly status: "recovered";
      readonly owner: OwnerIdentityRecord;
      readonly session: OwnerSessionRecord;
    }
  | { readonly status: "invalid" | "expired" | "locked" | "consumed" };

export interface IdentityStore {
  createOwnerWithSession(input: {
    readonly owner: OwnerIdentityRecord;
    readonly session: OwnerSessionRecord;
  }): Promise<ResolvedOwnerSession>;
  resolveSession(tokenHash: string, now: string): Promise<ResolvedOwnerSession | null>;
  beginEmailVerification(input: {
    readonly endpoint: VerificationEndpointRecord;
    readonly challenge: VerificationChallengeRecord;
  }): Promise<{
    readonly endpoint: VerificationEndpointRecord;
    readonly challenge: VerificationChallengeRecord;
  }>;
  consumeEmailVerification(input: {
    readonly ownerId: string;
    readonly challengeId: string;
    readonly tokenHash: string;
    readonly now: string;
  }): Promise<ConsumeVerificationResult>;
  getVerificationEndpoint(
    ownerId: string,
    endpointId: string,
  ): Promise<VerificationEndpointRecord | null>;
  listVerificationEndpoints(ownerId: string): Promise<VerificationEndpointRecord[]>;
  revokeVerificationEndpoint(
    ownerId: string,
    endpointId: string,
    now: string,
  ): Promise<VerificationEndpointRecord | null>;
  beginOwnerRecovery(input: {
    readonly addressHash: string;
    readonly challenge: Omit<OwnerRecoveryChallengeRecord, "ownerId" | "endpointId">;
  }): Promise<{
    readonly endpoint: VerificationEndpointRecord;
    readonly challenge: OwnerRecoveryChallengeRecord;
  } | null>;
  consumeOwnerRecovery(input: {
    readonly challengeId: string;
    readonly tokenHash: string;
    readonly now: string;
    readonly session: Omit<OwnerSessionRecord, "ownerId">;
  }): Promise<ConsumeOwnerRecoveryResult>;
  beginOwnerDeletion(intent: OwnerDeletionIntentRecord): Promise<OwnerDeletionIntentRecord>;
  deleteOwnerPrivateData(input: {
    readonly ownerId: string;
    readonly sessionId: string;
    readonly deletionId: string;
    readonly now: string;
  }): Promise<boolean>;
}

export interface SecretCodec {
  createSessionToken(): string;
  createVerificationCode(): string;
  hash(purpose: "owner_session" | "email_verification" | "owner_recovery", value: string): string;
}

export interface EmailProtector {
  protect(email: string): {
    readonly normalized: string;
    readonly addressHash: string;
    readonly addressCiphertext: string;
    readonly maskedAddress: string;
  };
}

export interface IdentityIdFactory {
  owner(): string;
  session(): string;
  endpoint(): string;
  challenge(): string;
  recovery(): string;
  deletion(): string;
}
