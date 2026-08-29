# Task 13 final submission checklist

## Claims and links

- [ ] Replace **[PRODUCTION_URL]**, **[VIDEO_URL]**, and **[REPOSITORY_URL]**
      in `devpost-copy.md`.
- [ ] Confirm the live URL loads signed out and the fallback UI works without
      WebMCP.
- [ ] Confirm the submitted build, video, gallery, and Devpost copy describe
      the same implemented behavior.
- [ ] Confirm the Devpost copy carries the tagline “Find once. Stay updated.
      Apply with control.” and both formulas (“Not an AI job board…” and
      “Jobbbler does not only expose tools…”) verbatim.
- [ ] Verify public repository, license, local-run instructions, and any
      required attribution.
- [ ] Remove any claim that cannot be shown in the recorded build.

## WebMCP and demo proof

- [ ] Verify WebMCP in a supported browser context using the real route tools.
- [ ] Verify the global Agent layer on more than one route: its stable six-tool
      core remains available, while contextual tools change safely with route
      and state.
- [ ] Record actual registration/readiness, route-relevant tool activity,
      search, compare, saved alert, and application boundaries.
- [ ] Confirm the video matches the storyboard's 0–160s beats and narration
      lines, including the delta beat (“Since the last check…”) and the
      permission stop.
- [ ] Show that an unavailable or unsupported context leaves the ordinary UI
      usable.
- [ ] Confirm tool output/activity does not expose secrets, reusable
      credentials, raw PII, or raw source payloads.

## Alert and application safety

- [ ] Use a synthetic/owned verified endpoint; do not display its full address
      or OTP.
- [ ] Show real latest-run and delivery state, including a truthful retry-safe
      state if used.
- [ ] Use the clearly fictional internal-demo employer for application
      submission footage.
- [ ] Demonstrate the real agent-client permission presentation, the
      payload-bound approval, the delegation/review boundary, and the
      short-lived final confirmation as distinct states.
- [ ] Describe the stored interaction as a record of what was approved in its
      exact context, never as cryptographic proof of the human, model, or
      vendor.
- [ ] Do not display confirmation tokens, cookies, database values, provider
      IDs, or ciphertext.

## Media and Devpost readiness

- [ ] Keep final video below three minutes, with intelligible audio and
      visible UI at normal playback speed.
- [ ] Confirm gallery screenshots show the current global Agent layer — the
      three-tab Guide / Activity / Tools hierarchy, stable-core/contextual
      distinction, and current readiness state — not an older rail.
- [ ] Record the current verification evidence accurately: `pnpm verify` 97
      passed / 1 skipped files, 403 passed / 25 skipped tests, production build
      passed; focused E2E 11/11; local PostgreSQL 15 contract 30/30.
- [ ] Validate gallery image crops, captions, alt text, dimensions, and
      file-size limits on Devpost.
- [ ] Check spelling, team/attribution fields, rules acknowledgement, and URLs
      immediately before submission.
- [ ] Do not submit from this checklist. Obtain the user’s action-time
      confirmation on the exact Devpost project and fields first.
