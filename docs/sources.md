# Sources and availability

Jobbbler treats each job source as a governed input, not as blanket permission to crawl, redistribute, or submit applications. Connector policy is checked before a network request and controls whether a source is enabled, its allowed purpose, polling interval, request and response bounds, raw-evidence retention, attribution, and terms links.

The detailed connector contract, current source posture, completeness rules, and fixture/live distinction are in [Source ingestion and governance](architecture/source-ingestion.md).

## Current operating posture

The challenge release uses only the checked-in fictional Jobbbler catalog. The
Jobicy, Remote OK, and Arbeitnow connectors remain implemented and tested, but
all three checked-in policies are disabled. A production worker therefore
cannot silently mix an upstream listing into the 300 managed demo roles.

Connector fixtures exercise the same normalization and governance boundary in
tests without contacting an upstream source. Enabling any live source requires
an intentional reviewed policy change, a rights and attribution review, and a
separate bounded deployment verification.

An enabled connector is not a promise that an upstream service is available, complete, current, or licensed for a new purpose. Source data retains its attribution and canonical link, and untrusted source text is not rendered as trusted HTML or interpreted as an instruction.

## Freshness and closure

Only a successful complete run can age unseen listings. Partial, failed, cancelled, rate-limited, or policy-blocked runs do not close a job. A listing moves through the configured miss states only when complete observations support that conclusion; a later observation reopens it. The product should therefore present source and freshness evidence rather than treating the catalog as a guarantee of live hiring status.

## Retention and evidence

The worker keeps immutable source identity, hashes, normalization outcomes, and job-version evidence. Raw source payloads are stored separately and are purged after the source policy's retention period, leaving metadata and hashes needed to explain the catalog decision. Raw payloads are not sent to WebMCP, activity projections, or public job rendering.

Retention cleanup runs from the catalog worker path. The challenge release has
no retained upstream payloads and runs an alert-only worker. A future deployment
that intentionally enables a source must also operate the catalog retention
path.

## Connector kill switch and source incidents

The implemented kill switch is the checked-in source policy: set the connector to disabled, deploy the reviewed policy, and restart or redeploy the catalog worker. This prevents subsequent fetches through the governed worker path. It is not a browser-facing, real-time administrative toggle, and it does not retrospectively erase retained evidence.

Use the following sequence when a source changes terms, rate limits, returns malformed data, or raises a rights concern:

1. Disable the connector in policy and stop live ingestion for that source.
2. Preserve safe run metadata, policy version, timestamps, and hashes; do not copy raw payloads into tickets.
3. Review the source's terms, attribution, permitted purpose, retention, and redistribution posture.
4. Update the connector/policy and its tests only after the review supports the new behavior.
5. Re-enable with a bounded run and verify completeness, attribution, and freshness before relying on the data.

## During demonstrations and judging

Seed the canonical fixture catalog for every demonstration. Live ingestion is
outside the challenge-release operating posture. Jobbbler does not claim a
public hosted feed, provider quota, or continuous upstream availability for the
judging period. For deployment and worker-mode guidance, see
[Operations](operations.md).
