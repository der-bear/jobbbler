# Agent-first application experience

Status: approved direction, 2026-08-29

## Outcome

Jobbbler should remove the repetitive work from applying, not turn it into a four-step approval form. A browser agent finds the role, opens or resumes one owner-bound draft, reuses approved profile facts, drafts role-specific answers, and asks only for missing or sensitive facts. The person receives one concise final review and makes one deliberate submission decision.

The design preserves the kickoff invariant: every submitted application is bound to an immutable payload, an exact recipient and purpose, a current privacy notice, and a fresh single-use human confirmation.

## Human journey

1. **Preparing** — the agent fills the draft and reports progress. The page lists only unresolved questions or blockers. A manual fallback remains available.
2. **Ready for review** — one document-like screen shows the role, employer, answers, documents, declarations, and the exact information that will be shared.
3. **Review and submit** — one affirmative action accepts the visible answers, authorizes that exact disclosure, creates a short-lived confirmation, and submits the sealed payload. A material edit invalidates every downstream record.
4. **Receipt** — show the truthful provider result, timestamp, and private receipt. External roles are handed off and never described as submitted by Jobbbler.

The UI does not expose delegation records, data-grant records, payload hashes, or confirmation tokens as separate workflow steps. Those records remain server-side safeguards.

## Consent and authority

- **Profile use:** reusable, category-scoped, revocable permission for Jobbbler to use selected saved facts while preparing drafts. It never grants disclosure to an employer.
- **Agent preparation:** short-lived, revocable, draft-bound authority for reversible preparation operations. It cannot approve disclosure or submit.
- **Application submission:** mandatory recipient-, purpose-, notice-, and payload-bound human confirmation for each application. The final review action records disclosure permission and submission confirmation together because the person sees the same exact payload once.

The agent may propose narrative answers. Sensitive or legally meaningful facts such as work authorization are never invented. They become part of the submitted payload only when the person confirms the final review.

## WebMCP surface

Use outcome-oriented tools with stable schemas and explicit next actions:

- `prepare_application(jobId)` creates or reopens one draft, navigates to it, and returns `created` or `reopened`, readiness, and the next action.
- `get_application_readiness(draftId)` returns safe progress, missing items, and the next valid action without private answers.
- `propose_application_updates(draftId, patches[])` applies bounded agent suggestions in one call.
- `prepare_application_review(draftId)` validates completeness and seals the immutable review.
- `request_submission_confirmation(draftId)` returns one human-interaction presentation for the exact review and disclosure.
- `submit_application(draftId)` submits only when the server can match active preparation authority, disclosure, review, and single-use confirmation.

The complete functionality is discoverable from every page, but agents should not choose among a long list of low-level lifecycle verbs. State-gated execution returns structured `NOT_FOUND`, `CONFLICT`, or `REQUIRES_USER_ACTION` results and never reports navigation or submission that did not occur.

## Activity model

Activity is a judge-facing receipt, not a raw debug log. Repeated idempotent calls collapse into one row with a count. Creating and reopening are distinct summaries. Zero-duration noise is omitted. No raw candidate data, credentials, confirmation tokens, or private identifiers appear.

## Server invariants

- Starting twice for the same owner and job returns the same draft.
- Batch updates are version-checked and preserve per-answer provenance.
- A final review is immutable and includes recipient, disclosure, notice, documents, declarations, and payload hashes.
- Any material edit invalidates the review, permission, and confirmation.
- Submission is atomic and idempotent; uncertain provider state is not reported as success.
- Cross-owner and cross-draft access always fails without revealing resource existence.

## Verification

- Domain and route tests cover idempotent start, agent suggestions, missing sensitive facts, review invalidation, confirmation expiry, duplicate submission, and truthful external handoff.
- Tool tests cover every allowed and disallowed state with structured, recoverable results.
- Browser tests cover agent preparation, the single final review action, receipt history, retry/error states, keyboard navigation, reduced motion, and mobile layout.
- Weak and strong model evals verify that the outcome-oriented tool set is selected without route or lifecycle confusion.
