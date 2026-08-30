# Agent-first application experience

Status: approved direction, 2026-08-29

## Outcome

Jobbbler should remove the repetitive work from applying, not turn it into a
four-step approval form. For a managed internal role, a browser agent opens or
resumes one owner-bound draft, drafts role-specific answers from supplied facts,
and asks only for missing or sensitive facts. The person receives one concise
final review in the external agent client and makes one deliberate submission
decision. External roles continue only on an available validated HTTPS employer
page; if none is available, the workflow stops. Jobbbler creates no draft or
submitted claim for them.

The design preserves the kickoff invariant: every submitted application is bound to an immutable payload, an exact recipient and purpose, a current privacy notice, and a fresh single-use human confirmation.

## Human journey

1. **Preparing** — the agent fills the internal-role draft and reports progress.
   The page lists only unresolved questions or blockers. A purely manual draft
   may use the first-party flow; once assistance is requested or an agent
   suggestion exists, the site is read-only and revisions, assistance,
   disclosure, and submission decisions remain in the external agent client.
2. **Ready for review** — one document-like screen shows the role, employer, answers, documents, declarations, and the exact information that will be shared.
3. **Review and submit** — one request-bound decision accepts the exact reviewed
   answers, authorizes that disclosure, creates a short-lived confirmation, and
   submits the sealed payload. The external agent client owns this decision for
   an agent-assisted draft; the first-party UI owns it only for a purely manual
   draft. A material edit invalidates every downstream record.
4. **Receipt** — show the truthful internal-demo provider result, timestamp, and
   private receipt. External roles create no Jobbbler draft, receipt, handoff
   record, or submitted claim.

The UI does not expose delegation records, data-grant records, payload hashes, or confirmation tokens as separate workflow steps. Those records remain server-side safeguards.

## Consent and authority

- **Profile use:** reusable, category-scoped, revocable permission for Jobbbler to use selected saved facts while preparing drafts. It never grants disclosure to an employer.
- **Agent preparation:** short-lived, revocable, draft-bound authority for reversible preparation operations. It cannot approve disclosure or submit.
- **Application submission:** mandatory recipient-, purpose-, notice-, and payload-bound human confirmation for each application. The final review action records disclosure permission and submission confirmation together because the person sees the same exact payload once.

The agent may propose narrative answers. Sensitive or legally meaningful facts such as work authorization are never invented. They become part of the submitted payload only when the person confirms the final review.

## WebMCP surface

Use outcome-oriented tools with stable schemas and explicit next actions:

- `get_job_application_capability(jobId)` determines whether the role is managed
  internally, has an available validated employer page, or must stop because no
  safe destination is available.
- `prepare_application(jobId)` creates or reopens one managed internal draft,
  navigates to it, and returns `created` or `reopened`, readiness, and the next
  action.
- `get_application_readiness(draftId)` returns safe progress, missing items, and the next valid action without private answers.
- `request_application_assistance(draftId)` returns one request-bound assistance
  presentation for the external agent client.
- `decide_application_assistance(draftId, requestId, decision)` records only the
  person's explicit approval or decline for that exact request, or withdraws
  active assistance bound to that same request.
- `propose_application_updates(draftId, patches[])` applies bounded agent suggestions in one call.
- `request_submission_review(draftId)` returns the exact reviewed values,
  sensitivity markers, recipient, purpose, notice, request ID, and draft version
  for presentation in the external agent client. It submits nothing.
- `decide_application_submission(draftId, requestId, draftVersion, decision)`
  records only the person's explicit decision and submits the unchanged internal
  application once if approved.
- `withdraw_application_consent(draftId)` stops future consent-based processing
  without rewriting a truthful historical receipt.

The complete functionality is discoverable from every page, but agents should not choose among a long list of low-level lifecycle verbs. State-gated execution returns structured `NOT_FOUND`, `CONFLICT`, or `REQUIRES_USER_ACTION` results and never reports navigation or submission that did not occur.

## Activity model

Activity is a judge-facing receipt, not a raw debug log. Repeated idempotent
calls collapse into one row with a count. Creating and reopening are distinct
summaries. Zero-duration noise is omitted. No raw candidate data, credentials,
confirmation tokens, or private identifiers appear in activity; exact candidate
values appear only in the bounded pending-review result with sensitivity
markers.

## Server invariants

- Starting twice for the same owner and job returns the same draft.
- Batch updates are version-checked and preserve per-answer provenance.
- A final review is immutable and includes recipient, disclosure, notice, documents, declarations, and payload hashes.
- Any material edit invalidates the review, permission, and confirmation.
- Submission is atomic and idempotent; uncertain provider state is not reported as success.
- The storage transaction rechecks manual-versus-assisted lineage before it
  consumes confirmation state; delegation creation serializes on the same
  draft lock.
- Cross-owner and cross-draft access always fails without revealing resource existence.

## Verification

- Domain and route tests cover idempotent start, agent suggestions, missing
  sensitive facts, review invalidation, confirmation expiry, duplicate
  submission, and external roles that either open a validated page or stop
  without creating a draft.
- Tool tests cover every allowed and disallowed state with structured, recoverable results.
- Browser tests cover agent preparation, the single final review action, receipt history, retry/error states, keyboard navigation, reduced motion, and mobile layout.
- Weak and strong model evals verify capability-first internal versus external
  branching, recovery before private reads, and outcome-oriented tool selection
  without route or lifecycle confusion.
