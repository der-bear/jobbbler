# Source Ingestion and Governance

Jobbbler treats a public job feed as permission to perform only the operations explicitly allowed by that source. Reading a listing never grants permission to submit an application, redistribute unrestricted content, or poll without limits.

## Connector boundary

Every source implements one `JobConnector` contract. A connector may fetch bounded pages, retain attributed raw evidence, and normalize IT or adjacent-technology listings. It cannot write directly to the catalog, choose an authorization policy, or expose a source-specific UI model.

The worker checks the versioned source policy before any request. The policy controls:

- enabled state and allowed purpose;
- minimum polling interval;
- request timeout, response byte limit, and record limit;
- raw-payload retention;
- redistribution and commercial-use posture;
- required attribution and canonical source links;
- official source and terms URLs.

## Current source posture

| Source    | Challenge-release posture | Guardrail if a future reviewed deployment enables it                      |
| --------- | ------------------------- | ------------------------------------------------------------------------- |
| Jobicy    | Disabled                  | At most once per 6 hours; preserve attribution and the canonical URL      |
| Remote OK | Disabled                  | At most once per 12 hours; followed backlink required; never use its logo |
| Arbeitnow | Disabled                  | Written permission and policy review required before any production use   |

The product catalog is the checked-in fictional set of 300 Jobbbler-managed
roles. Connector fixtures exercise every source adapter in automated tests
without making an upstream request. An explicit `--live` invocation is still
blocked by the checked-in policies; command-line intent never overrides source
governance.

## Evidence and idempotency

The ingestion write path is short and transactional, while network calls remain outside database transactions.

1. `source_runs` records purpose, policy version, completeness, counts, HTTP validators, response bytes, and a terminal result.
2. `source_records` stores immutable source identity and payload hash. The unique key `(source, partition, external ID, raw hash)` makes replay idempotent.
3. `source_payloads` holds the raw JSON separately so retention cleanup can remove payload data without deleting evidence metadata or hashes.
4. `normalization_results` records an immutable accepted, rejected, or quarantined decision for a versioned normalizer.
5. `job_versions` preserves each distinct normalized job representation.
6. `job_source_links` tracks first seen, last seen, current freshness, and reappearance by stable source identity.

Rejected and out-of-taxonomy records remain auditable evidence until their payload retention expires. Their raw payload is never rendered as trusted HTML or passed through as an instruction.

## Completeness and freshness

Only a successful, complete source run may age unseen listings. A partial, failed, cancelled, rate-limited, or policy-blocked run cannot close a job.

An unseen listing becomes `possibly_closed` after one complete miss and `closed` after two consecutive complete misses. The public job moves from `open` to `stale`, then to `closed`, unless another active source identity still supports it. A later observation resets the miss count and reopens the listing.

## Operations

Use the canonical demo catalog for deterministic local verification:

```bash
pnpm db:seed
pnpm db:restore-verify
```

Verify the dormant connector boundary offline:

```bash
pnpm --filter @jobbbler/connectors test
pnpm --filter @jobbbler/worker test
```

Production runs `JOBBBLER_WORKER_MODE=alert_service`; this is also the safe
production default when the variable is omitted. Catalog and combined modes
remain available only for a future deployment that deliberately enables a
reviewed source policy. Deterministic work buckets and persisted policy state
then prevent the service cadence from over-polling that source.

The worker emits a redacted event for run start, each accepted or rejected record, policy blocks, completion, and failure. The realtime projection may visualize these events, but repository state remains authoritative.
