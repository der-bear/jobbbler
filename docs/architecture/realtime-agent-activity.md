# Realtime Agent Activity

## Purpose

Jobbbler uses WebSocket delivery to make agent and background work understandable in real time. The stream powers the Agent Activity rail, point-of-effect highlights, accessible announcements, source-health updates, alert-run progress, and application state transitions.

The stream is an observable projection, not a command channel and not a source of truth. Every state-changing action still passes through the typed HTTP command boundary and server authorization.

## Event envelope

```ts
export interface RealtimeEvent {
  id: string;
  cursor: string;
  type: string;
  occurredAt: string;
  aggregate: { type: string; id: string; version: number };
  correlationId: string;
  causationId?: string;
  actor: { kind: "human" | "agent" | "service"; display: string };
  summary: string;
  effects: readonly {
    target: string;
    kind: "refresh" | "highlight" | "announce" | "focus";
  }[];
}
```

The public contract is versioned. Unknown event types are ignored safely. Event summaries are concise English strings generated from trusted domain data, never from raw job HTML or arbitrary user text.

## Delivery flow

1. A state-changing command commits its aggregate mutation, audit record, and outbox event atomically.
2. The realtime publisher claims outbox rows after commit and creates a redacted projection.
3. The gateway authorizes the human session and requested owner/resource channels.
4. The event is delivered with an increasing cursor and aggregate version.
5. The client applies safe visual effects and reconciles relevant cached state.
6. On reconnect, the client sends the last acknowledged cursor. The server replays the bounded retained window.
7. A cursor gap, unknown version, or replay-window miss triggers an authoritative refetch before more effects are rendered.

## Channel model

- Public catalog channels carry only non-sensitive freshness and source-health summaries.
- Owner channels carry redacted activity for resources owned by the authenticated human principal.
- Resource channels require both owner access and resource membership on every subscription.
- Operator channels require explicit platform roles and are never exposed to ordinary users.

Channel names visible to clients use opaque IDs. Authorization never depends on knowing a channel name. Browser authentication uses the secure same-site session; access tokens are not passed in query strings or logged subprotocol values.

## Reliability

- Heartbeat and idle timeout detect half-open connections.
- Exponential reconnect uses jitter and a maximum delay.
- Each connection has bounded outbound buffers; slow consumers receive a resync request rather than unbounded memory growth.
- Event publishing is at-least-once. Clients deduplicate by event ID and compare aggregate version.
- Outbox claims use leases and idempotent publish records.
- A polling fallback keeps authoritative status usable when WebSocket delivery is blocked.
- UI controls never wait on the event stream to confirm a command response.

## Privacy and security

Realtime payloads never include:

- session, verification, recovery, delegation, or confirmation secrets;
- full application answers, profile fields, résumés, or attachments;
- email addresses or other notification endpoints;
- raw connector payloads or source HTML;
- arbitrary model output.

The gateway validates `Origin`, session, role, channel membership, event schema, payload size, rate, and connection count. Logs store correlation and event IDs rather than sensitive payloads. Revocation closes affected subscriptions or causes the next authorization refresh to remove them.

## Adapters

Local SQLite development uses an in-process or worker-side WebSocket gateway fed by the same outbox interface. Production may use Supabase Realtime or another managed WebSocket service only if it passes the same contract, RLS/channel authorization, replay, redaction, and failure-mode tests. Adapter choice must not change domain commands or UI semantics.

## UX behavior

- A running WebMCP call appears immediately as local pending activity and is replaced by the correlated committed event.
- Accepted filter changes briefly highlight only affected chips and result regions.
- Authorization and consent requests remain visible until the human resolves them; they never auto-dismiss as success.
- Revoke and undo actions show their scope and consequence before execution.
- Screen readers receive one concise live announcement per committed state change, not per transport retry.
- Reduced-motion users receive color, text, and focus changes without pulsing animation.

## Release tests

- authorization denies cross-owner and guessed-channel subscriptions;
- reconnect replays exactly the missing retained events and deduplicates repeats;
- a version gap forces refetch;
- slow-consumer behavior is bounded;
- revoke removes access;
- secrets and personal fields fail schema/redaction gates;
- polling fallback preserves critical journeys;
- WebMCP tool correlation appears in Agent Activity and at the point of effect;
- light/dark, mobile, keyboard, reduced-motion, and screen-reader behavior remain usable.
