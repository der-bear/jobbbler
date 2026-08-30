# Task 13 final submission checklist

## Claims and links

- [ ] Replace **[PRODUCTION_URL]** and **[VIDEO_URL]** in `devpost-copy.md`.
- [ ] Confirm the live URL loads signed out and the fallback UI works without
      WebMCP.
- [ ] Confirm the submitted build, video, gallery, and Devpost copy describe
      the same implemented behavior.
- [ ] Confirm the Devpost copy carries the tagline “Find once. Stay updated.
      Apply with control.” and both formulas (“Not an AI job board…” and
      “Jobbbler does not only expose tools…”) verbatim.
- [x] Verify public repository, MIT license, local-run instructions, and any
      required attribution.
- [ ] Remove any claim that cannot be shown in the recorded build.

## WebMCP and demo proof

- [ ] Verify WebMCP in a supported browser context using the real registered
      tools.
- [ ] Verify the global Agent layer on more than one route: the same 26 focused
      imperative tools stay registered everywhere, and state-gated tools
      answer with a clear next step when they are not ready.
- [ ] Record actual registration/readiness, tool activity, search, compare,
      saved alert, and application boundaries.
- [ ] Demonstrate the agent-native alert pair from the external client:
      `request_search_alert` returns the exact review with a masked destination,
      the person decides and supplies the mailbox code there, and
      `decide_search_alert` activates only the unchanged request.
- [ ] Confirm the video matches the storyboard's 0–160s beats and narration
      lines, including the delta beat (“Since the last check…”) and the
      person's decision stop before anything is shared or submitted.
- [ ] Show that an unavailable or unsupported context leaves the ordinary UI
      usable.
- [ ] Confirm activity, readiness, and safe errors expose no secrets, reusable
      credentials, real PII, or raw source payloads. The pending exact review
      may show only the synthetic application values, with sensitive fields
      marked explicitly.

## Alert and application safety

- [ ] Use a synthetic/owned verified endpoint; do not display its full address
      or OTP.
- [ ] Verify a declined alert review creates no schedule, a missing or wrong
      mailbox code activates nothing, and an approved exact review produces one
      non-null schedule and a retry-stable receipt.
- [ ] Show real latest-run and delivery state, including a truthful retry-safe
      state if used.
- [ ] Use the clearly fictional internal-demo employer for application footage.
- [ ] Demonstrate `request_application_assistance`, the person's assistance
      decision relayed by `decide_application_assistance`, and only then
      `propose_application_updates`.
- [ ] Confirm the site offers no approval, consent, confirmation, or submission
      bypass after assistance is requested or an agent-suggested answer exists;
      it renders that lineage read-only, while a purely manual draft remains
      editable and may still finish in the first-party UI.
- [ ] Confirm `decide_application_assistance` can withdraw active assistance
      only with its exact live request ID and returns the revoked authority
      state without adding another tool.
- [ ] Confirm a pending data grant is reused only for its decision channel and
      exact request, and both storage adapters reject a late assistance request
      before consuming a first-party confirmation.
- [ ] Present the exact request-bound submission review in the external agent
      client and stop with that decision pending; do not invoke submission or
      claim that data was shared.
- [ ] Confirm an external role opens only an available validated HTTPS employer
      page, stops when none is available, and creates no Jobbbler draft, receipt,
      handoff record, or submitted claim.
- [ ] Describe the stored interaction as a record of what was approved in its
      exact context, never as cryptographic proof of the human, model, or
      vendor.
- [ ] Do not display confirmation tokens, cookies, database values, provider
      IDs, or ciphertext.

## Media and Devpost readiness

- [ ] Keep final video below three minutes, with intelligible audio and
      visible UI at normal playback speed.
- [ ] Confirm gallery screenshots show the current global Agent layer — the
      Activity / Tools / Guide tab order, current readiness state, and Tools
      groups Find / Inspect and compare / Alerts / Apply — not an older rail.
- [ ] Re-run `pnpm verify`, the focused E2E suite, and the local PostgreSQL
      contract suite on the final build and record the fresh numbers.
- [x] Validate gallery image crops, captions, alt text, dimensions, and
      file-size limits on Devpost.
- [x] Recapture all four gallery crops on the final interface, then revalidate
      captions, alt text, 3:2 dimensions, and file-size limits.
- [ ] Check spelling, team/attribution fields, rules acknowledgement, and URLs
      immediately before submission.
- [ ] Do not submit from this checklist. Obtain the user’s action-time
      confirmation on the exact Devpost project and fields first.
