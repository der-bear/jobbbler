# Security

Jobbbler is a server-mediated job-discovery and application-preparation product. This page describes controls that exist in the checked-in implementation; it is not a claim of a managed hosting service, an external security certification, or an availability guarantee.

## Trust boundaries

- The browser receives public job data and purpose-limited API responses. Database URLs, provider keys, encryption material, owner-session tokens, agent tokens, confirmation tokens, and encrypted email envelopes are server-only values.
- A private owner session is an HttpOnly, same-site cookie. In production it is secure and uses the `__Host-` cookie prefix. The database stores a one-way token hash rather than the raw token.
- State-changing browser requests require the configured trusted origin. Sensitive JSON routes stream and cap request bodies before schema validation.
- Durable storage-backed limits protect identity, authorization, and private activity paths. Deployments behind a proxy must configure client-address trust only when that proxy replaces the forwarded headers; see the environment comments in [`.env.example`](../.env.example).

## Identity, consent, and applications

Email addresses are normalized, encrypted with AES-256-GCM using authenticated associated data, and indexed with a separate HMAC lookup digest. Public responses contain only a masked destination. Verification codes, owner-session tokens, agent-session tokens, and final-confirmation tokens are never persisted in raw form.

Application preparation has separate server-enforced boundaries for owner access, a narrowly scoped agent delegation, an exact reviewed disclosure, a current data grant, and a five-minute single-use human confirmation. The submission transaction checks the owner, draft version, immutable review hash, confirmation, and exact data-grant scope before advancing the draft and creating a receipt.

For an external role, Jobbbler exposes only an available validated HTTPS employer application page; when none is available, the workflow stops. It creates no application draft, prepares or discloses no application data, records no receipt or handoff, and makes no submitted claim. Historical `handed_off` records remain readable only for legacy compatibility; current server and storage writers cannot create them.

The detailed boundary model is in [Agent authorization and data consent](architecture/agent-authorization-and-consent.md).

## WebMCP and activity

WebMCP capability is feature-detected; it is not identity or authority. Registered tools use typed schemas, bounded outputs, cancellation propagation, and route/state cleanup. Server authorization remains at the HTTP command boundary.

The Agent Activity rail combines local activity with a sanitized, owner-scoped projection. It is not the immutable audit log and is never a command channel. Authoritative state comes from the regular API. Polling is the delivery baseline; optional Supabase broadcasts carry only a wake-up signal and do not carry activity data or confer access. See [Realtime Agent Activity](architecture/realtime-agent-activity.md).

## Database and deployment controls

SQLite is the local default and enables foreign keys and WAL on each connection. PostgreSQL/Supabase is selected only by a server-side `DATABASE_URL`; browser variables are limited to the optional public Supabase Realtime configuration. PostgreSQL migrations enable deny-by-default RLS for browser-accessible private data, while the web and worker adapters still perform their own owner and authorization checks.

Production responses use no-sniff, frame-deny, strict referrer, restrictive permissions, HSTS, and a CSP limited to same-origin assets plus an explicitly configured HTTPS/WSS Supabase origin. The exact headers and health behavior are documented in [Health and security operations](operations/health-and-security.md). The deployment boundary, separate web/worker images, and database setup are documented in [Deployment](operations/deployment.md).

## Logs and incident handling

The web process emits structured Pino logs with request/correlation identifiers and redacts cookies, authorization values, email/address fields, ciphertext, and token fields. Worker cycle logs contain safe run counts, source keys, status, and error codes; they are suitable for deriving operational metrics in the deployment's log platform. There is no built-in Prometheus-style metrics endpoint or hosted alerting service.

Treat a suspected token, email, ciphertext, or provider-key exposure as an incident: stop the affected writer if necessary, preserve redacted log evidence, rotate the affected provider credential, and follow [Operations](operations.md). Do not paste raw database rows, encrypted envelopes, HTTP request headers, or bearer credentials into tickets or logs.

## Scope notes

- This repository does not publish a public production URL or provider credentials.
- It does not claim a complete WebSocket transport: polling remains authoritative and Supabase Realtime is an optional accelerator.
- Passwordless recovery uses enumeration-safe start responses, short-lived single-use challenges, atomic session rotation, and encrypted verified endpoints.
- Private-data deletion is human-only, requires two exact confirmations, atomically removes owner-owned private rows and sessions, and retains only non-identifying integrity tombstones.
