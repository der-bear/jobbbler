# Realtime Agent Activity

## Purpose

Jobbbler uses a durable cursor feed to make agent and background work understandable in near real time. The feed powers the Agent Activity rail and leaves room for point-of-effect highlights, accessible announcements, source-health updates, alert-run progress, and application state transitions. Supabase Realtime can shorten the time to the next feed read, but it is never the data source.

The stream is an observable projection, not a command channel and not a source of truth. Every state-changing action still passes through the typed HTTP command boundary and server authorization.

## Event envelope

```ts
export interface OwnerActivityEvent {
  id: string;
  schemaVersion: 1;
  kind:
    | "tool"
    | "authorization"
    | "consent"
    | "application"
    | "saved_search"
    | "schedule"
    | "source_health";
  key: string;
  status: "running" | "completed" | "requires_user_action" | "failed" | "cancelled";
  safeSummary: string;
  correlationId: string;
  actorKind: "human" | "agent" | "service";
  aggregate: {
    type: "application_draft" | "saved_search" | "schedule" | "source" | "system";
    version: number;
  };
  occurredAt: string;
  effects: readonly {
    target: "agent_activity" | "application" | "saved_searches" | "search_results";
    kind: "refresh" | "highlight" | "announce" | "focus";
  }[];
}
```

The public contract is strict and versioned. The storage boundary rejects unknown fields and summaries containing credentials, URLs, portable resource IDs, email-like values, markup, or long token-like strings. Events deliberately omit owner IDs, actor IDs, aggregate IDs, arbitrary metadata, source records, and raw command payloads. The signed cursor lives in the page envelope rather than in each event.

`actorKind` records operational provenance from a trusted route or decision
channel, not cryptographic identity. For example, an explicit decision relayed
through the agent-client channel is shown as agent activity even though the
decision evidence separately records the person's request-bound action. The
imperative WebMCP API does not prove which human, model, or agent vendor supplied
that action.

## Delivery flow

1. A command commits authoritative state and any audit, outbox, version, or idempotency facts required by that command.
2. After commit, a trusted best-effort publisher converts only allowlisted facts into `OwnerActivityEvent` and appends them through `OwnerActivityRepository`; generic audit metadata is never returned directly and projection failure never rolls back a successful command.
3. `GET /api/v1/owners/activity` resolves the HttpOnly owner session, applies a durable owner rate limit, decodes an HMAC-signed owner-bound cursor, and reads only that owner's rows.
4. The API returns events without persistence sequence or owner columns plus the next signed cursor. Responses are `no-store`, vary on `Cookie`, and contain no credential in a URL or response field.
5. The client validates the strict response, deduplicates by event ID or tool correlation, and merges committed entries into `AgentActivityStore`.
6. A retained-state reset returns `resyncRequired: true` and a bounded current snapshot. UI commands never wait for activity delivery.

## Channel model

The authoritative HTTP feed has no public or caller-selected channel parameter; the owner always comes from the verified session. PostgreSQL stores the projection in `jobbbler.owner_activity_events` with deny-by-default RLS and an owner-only read policy.

The optional Supabase channel is `private: true` and carries only an empty `changed` broadcast. Its signed Supabase Auth JWT must contain a valid `app_metadata.jobbbler_owner_id` claim matching the private topic policy. Without that independently authenticated claim, the adapter refuses to subscribe. The adapter reports the wake transport as active only after the private channel confirms `SUBSCRIBED`; channel setup errors leave polling at the server interval. The JWT is provided through the Realtime authentication API, never a query string, channel name, log field, or broadcast payload.

## Reliability

- Polling starts immediately and follows the server interval while the optional wake transport is omitted, pending, inactive, or rejected. Only a private Realtime channel that confirms `SUBSCRIBED` enables aggressive idle backoff, and confirmation schedules an immediate authoritative read to close the transport handoff.
- With a confirmed wake transport, a page with committed activity returns to the server interval and consecutive empty reads step from 10 to 20 toward a 30-second cap. Jitter is applied after capping, including a downward 27-to-30-second spread at the cap, so synchronized browser sessions do not converge on one timer.
- Transport failures use a separate exponential backoff, `Retry-After` is authoritative, hidden pages wait 30 seconds, and unmount aborts in-flight work.
- Catch-up is bounded to five immediate pages before returning to the normal interval.
- Realtime wakeups are coalesced while an HTTP read is active. Consuming a queued wake resets idle backoff after the stale read and before the immediate authoritative read.
- Event publishing may be at-least-once; the client deduplicates by event ID or correlation.
- The conventional UI and local WebMCP activity remain available when the owner has no session, Supabase is absent, a private channel cannot authorize, or WebSockets are blocked.
- UI controls never wait on the event stream to confirm a command response.

## Privacy and security

Realtime payloads never include:

- session, verification, recovery, delegation, or confirmation secrets;
- full application answers, profile fields, résumés, or attachments;
- email addresses or other notification endpoints;
- raw connector payloads or source HTML;
- arbitrary model output.

The HTTP boundary validates same-origin fetch metadata when present, owner session, cursor signature and binding, strict query size, event schema, monotonic sequence, owner binding, and durable rate. Logs never receive the cursor, token, event payload, or owner ID from this path. Revocation makes the next authoritative read fail; the Supabase JWT/channel policy is an additional boundary rather than a replacement.

## Adapters

SQLite and PostgreSQL implement the same owner-scoped projection repository. SQLite uses bounded polling only. PostgreSQL adds RLS. When the Supabase-managed `realtime` and `auth` functions exist, migration `0010_supabase_activity_wakeup.sql` installs a private-topic read policy and an insert trigger that calls `realtime.send('{}', 'changed', ...)`; no projection row data is broadcast. This follows Supabase's [database Broadcast model](https://supabase.com/docs/guides/realtime/broadcast).

Enable the accelerator only with all of the following:

- `NEXT_PUBLIC_SUPABASE_ACTIVITY_WAKEUPS=true`;
- a valid HTTPS `NEXT_PUBLIC_SUPABASE_URL` and public/publishable browser key;
- a signed Supabase Auth session whose app metadata carries the bound Jobbbler owner ID;
- migration `0010` applied in Supabase.

`ACTIVITY_POLL_INTERVAL_MS` controls the polling-only fallback and post-activity cadence from 1,000 to 30,000 ms and defaults to 5,000 ms. Realtime, visibility, and explicit wakeups reset idle backoff before the next authoritative read.

## UX behavior

- A running WebMCP call appears immediately as local pending activity and is replaced by the correlated committed event.
- Accepted search changes update the visible URL, filters, result count, and result status through the same client bridge used by the conventional surface.
- Authorization and consent requests remain visible until the human resolves them; they never auto-dismiss as success.
- Revoke and undo actions show their scope and consequence before execution.
- Screen readers receive concise result and activity announcements from validated state changes, not from transport retries.
- Reduced-motion users receive color, text, and focus changes without pulsing animation.

## Release tests

- authorization denies cross-owner cursors and private-channel subscriptions;
- reconnect replays exactly the missing retained events and deduplicates repeats;
- a version gap forces refetch;
- catch-up, retry, hidden-page, and wakeup behavior are bounded;
- revoke removes access;
- secrets and personal fields fail schema/redaction gates;
- polling fallback preserves critical journeys;
- WebMCP tool correlation appears in Agent Activity and at the point of effect;
- light/dark, mobile, keyboard, reduced-motion, and screen-reader behavior remain usable.
