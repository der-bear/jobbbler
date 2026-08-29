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

| Source    | Production posture | Polling ceiling                             | Display requirement                                                                     |
| --------- | ------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Jobicy    | Enabled            | Once per 6 hours                            | Show Jobicy attribution and the canonical listing URL                                   |
| Remote OK | Enabled            | Once per 12 hours                           | Show a followed Remote OK backlink wherever its data appears; do not use its logo       |
| Arbeitnow | Disabled           | Once per 24 hours in an approved evaluation | Connector is testable, but production use requires written permission and policy review |

Checked-in fixtures are fictional and exercise every connector without making an upstream request. Live ingestion requires an explicit `--live` invocation and still passes through the same policy gate.

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

Use fixture mode for deterministic local verification:

```bash
pnpm db:seed
pnpm ingest -- --source all --limit 50
pnpm db:restore-verify
```

Live source access is deliberate:

```bash
pnpm ingest:live -- --source jobicy --limit 50
```

Production runs `JOBBBLER_WORKER_MODE=catalog_service`. It performs a cycle immediately and then every `JOBBBLER_WORKER_INTERVAL_SECONDS` (five minutes by default), so expired raw payloads are purged on schedule even when no source is due. Deterministic work buckets and persisted policy state prevent the service cadence from over-polling upstream sources. `catalog_once` remains available for an infrastructure scheduler or a bounded operational run.

The worker emits a redacted event for run start, each accepted or rejected record, policy blocks, completion, and failure. The realtime projection may visualize these events, but repository state remains authoritative.
