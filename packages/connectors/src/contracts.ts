import type { Job } from "@jobbbler/contracts";

import type { FetchLike } from "./runtime.js";
import type { SourceKey, SourcePolicy } from "./policy.js";

export interface FetchPartitionInput {
  readonly partition: string;
  readonly page: number;
  readonly limit: number;
  readonly fetchedAt: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface FetchPartitionResult {
  readonly complete: boolean;
  readonly notModified: boolean;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly bytes: number;
  readonly nextPage: number | null;
}

export interface RawSourceRecord {
  readonly sourceKey: SourceKey;
  readonly partition: string;
  readonly externalId: string;
  readonly originalUrl: string;
  readonly applyUrl: string;
  readonly sourceUpdatedAt: string | null;
  readonly fetchedAt: string;
  readonly retainUntil: string;
  readonly rawHash: string;
  readonly payload: unknown;
  readonly policyVersion: number;
  readonly attribution: SourcePolicy["attribution"];
  readonly actionCapability: "external_only";
}

export interface NormalizedOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly website: string | null;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NormalizedSourceLink {
  readonly sourceKey: SourceKey;
  readonly partition: string;
  readonly externalId: string;
  readonly originalUrl: string;
  readonly applyUrl: string;
  readonly rawHash: string;
  readonly identityBasis: "source_id";
}

export type NormalizationResult =
  | {
      readonly accepted: true;
      readonly organization: NormalizedOrganization;
      readonly job: Job;
      readonly sourceLink: NormalizedSourceLink;
    }
  | {
      readonly accepted: false;
      readonly reason: "invalid_record" | "outside_tech_taxonomy";
      readonly validationIssues: readonly string[];
    };

export interface ConnectorDescriptor {
  readonly key: SourceKey;
  readonly label: string;
  readonly partitions: readonly string[];
  readonly actionCapability: "external_only";
  readonly conditionalRequests: "optional" | "undocumented";
}

export interface JobConnector {
  readonly descriptor: ConnectorDescriptor;
  readonly policy: SourcePolicy;
  fetchPartition(
    input: FetchPartitionInput,
    signal: AbortSignal,
  ): AsyncGenerator<RawSourceRecord, FetchPartitionResult, void>;
  normalize(record: RawSourceRecord): NormalizationResult;
}

export interface ConnectorDependencies {
  readonly policy: SourcePolicy;
  readonly fetch: FetchLike;
}
