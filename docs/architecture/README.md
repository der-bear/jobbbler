# Jobbbler Architecture

## Scope

Jobbbler is the IT and adjacent-technology jobs product. It is the only product in this repository and in its Devpost submission. A Local Services product may reuse architectural ideas, but it must have its own product context, implementation surface, evidence, media, and submission.

## Architectural goals

- Keep the conventional web experience complete and accessible without WebMCP.
- Make WebMCP materially reduce work across discovery, comparison, alerts, and one reviewed application.
- Keep domain policy independent from React, Next.js, databases, and browser APIs.
- Treat UI and agent calls as two adapters over the same typed commands.
- Preserve behavioral parity between local SQLite and production PostgreSQL/Supabase.
- Separate human identity, agent authorization, data authorization, and action confirmation.
- Make agent work observable through a redacted real-time stream without treating that stream as state.
- Keep external I/O outside database write transactions.

## Intelligence boundary

Jobbbler does not call a model provider. The visiting external browser agent
owns natural-language understanding and optional answer drafting; Jobbbler
owns the structured facts, deterministic search and ranking, workflow state,
validation, persistence, consent evidence, and consequential-action policy.
WebMCP is the typed boundary between those responsibilities.

This is intentional rather than a missing AI tier. It avoids paying for or
trusting a second hidden model to reinterpret the same request, keeps candidate
data in the chosen agent client until an exact operation is authorized, and
lets weak and strong clients use the same deterministic product contract. A
future provider-side AI operation would be a separately disclosed processor
and would require the same bounded input, provenance, and data-grant rules.

## Runtime boundaries

| Boundary               | Responsibility                                                            | Must not own                               |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/web`             | Server-rendered UI, BFF routes, trusted approval surfaces, WebMCP adapter | Domain rules, database-specific queries    |
| `apps/worker`          | Ingestion, schedules, notifications, action work, local realtime gateway  | Browser state, user-interface policy       |
| `packages/contracts`   | Runtime schemas and stable wire contracts                                 | Persistence or framework code              |
| `packages/core-domain` | Principals, delegations, data grants, schedules, audit, outbox            | React, HTTP, SQL drivers                   |
| `packages/jobs-domain` | Jobs, search, ranking, fit, application state machines                    | Browser, transport, storage implementation |
| `packages/storage`     | Repository interfaces and parity suites                                   | Concrete database assumptions              |
| Storage adapters       | SQLite or PostgreSQL implementation                                       | Business authorization decisions           |
| `packages/webmcp`      | Feature detection, route/state manifests, lifecycle, client activity      | Server authority or secrets                |
| `packages/ui`          | Tokens and accessible primitives                                          | Product-domain behavior                    |

## Command flow

1. A human control or WebMCP tool validates an input contract.
2. The BFF builds a command context with the human principal and, when relevant, an agent-session reference.
3. The application command revalidates ownership, delegation, data authorization, aggregate version, and idempotency.
4. The storage adapter performs the command's authoritative write with the required version, idempotency, audit, outbox, and confirmation invariants for that command. High-risk application submission claims are atomic; read and reversible preference commands do not pretend to create the same record set.
5. External work is claimed after commit by a worker using persisted leases and bounded retries.
6. After an eligible command commits, a best-effort publisher appends an allowlisted, redacted owner-activity projection. Failure to publish never changes the command result.
7. The UI reads that projection through an authenticated cursor-based HTTP feed. Optional Supabase Realtime sends only an empty wake-up signal so the client can poll sooner.
8. The UI reconciles against the authoritative API response or refetches when needed.

WebSocket delivery, tool registration, a public resource identifier, and an approval task handle are never sources of authority.

## Persistent data model

The shared base contains principals, agent sessions, delegations, data grants, audit events, outbox events, source records, saved searches, schedules, work items, and idempotency records. The jobs extension contains canonical jobs and versions, search evidence, application drafts, immutable reviews, confirmations, submissions, and receipts.

Application-generated sortable IDs and UTC timestamps cross database boundaries unchanged. Mutable aggregates have integer versions. SQLite enables foreign keys and WAL on every connection. PostgreSQL uses deny-by-default RLS for every browser-accessible private table.

## Documentation map

- [WebMCP capability matrix](./webmcp-capability-matrix.md)
- [WebMCP evaluation fixtures](./webmcp-evals.md)
- [Agent authorization and data consent](./agent-authorization-and-consent.md)
- [Realtime Agent Activity](./realtime-agent-activity.md)
- [Source ingestion and governance](./source-ingestion.md)
- [Product experience and visual hierarchy](../design/product-experience.md)
- [Security](../security.md)
- [Operations](../operations.md)
- [Sources and availability](../sources.md)

The original [kickoff specification](../kickoff/webmcp_universal_discovery_action_platform_spec.md)
and captured [challenge rules](../rules/rules.md) are preserved as source
material. They record the input and constraints, not a claim that every
explored capability shipped. These architecture documents and the tested code
are the durable source of truth for the implemented product.
