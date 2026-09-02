# Jobbbler submission film

This document is the single production contract for the Jobbbler challenge
film. The finished video must be a real product demonstration, not a concept
trailer: every agent message, WebMCP call, Activity entry, page state, saved
search, application review, decision, and receipt shown on screen comes from
the production build at <https://jobbbler.com>.

## The idea in one sentence

**A job search can take hours. The intent takes one sentence.**

Jobbbler demonstrates the missing interface for the agentic web. A person
states an outcome in the agent client they already chose. The live website
describes its useful actions to that agent, supplies current product data, and
enforces the same workflow rules as the human interface. No separate MCP
server is configured and the agent does not have to infer actions from pixels.

The film is not about an “AI job board.” It uses one familiar, high-friction
task to make a broader platform shift obvious: a website can now be directly
operable by a visiting agent while remaining a complete website for people.

## Creative direction

Use a hybrid branded proof film. Authentic browser and agent-client footage is
the evidence; Remotion provides the editorial frame, camera movement, pacing,
captions, and brand continuity. Do not create a fake chat, fake Site tools
popover, fake Activity entry, or recreated product UI.

The visual system extends the product rather than inventing a second brand:

- use the real Jobbbler wordmark and live status dot from the captured product;
- use Manrope for editorial type and IBM Plex Mono only for tool names;
- use the product ink, clean green signal, white canvas, and green-tinted
  neutrals from `packages/ui/src/tokens.css`;
- build the background from a restrained white-to-mint light field with one
  soft moving green glow and a barely visible grain layer;
- use frosted white panes only where they separate authentic captures from the
  background; keep their radius, hairline, and shadow consistent with the
  product;
- reserve green for live state, the current action, and primary emphasis;
  secondary labels stay ink and tertiary context stays neutral;
- never use purple, cyan, neon outlines, stock AI imagery, floating feature
  icons, or a generic “futuristic” grid.

The film begins and ends with the same live dot. At the start it wakes as the
website becomes agent-operable. At the end it settles beside the wordmark after
the requested outcome is complete.

## Narrative structure

Target runtime: **2 minutes 44 seconds**. Hard limit: **under 3 minutes**.
Master: **1920×1080, 30 fps, H.264, yuv420p, AAC 48 kHz**.

| Time      | Story beat                         | Authentic picture                                                                                                                                                                                                                                                                                                                                                                                                    | Narration                                                                                                                                                                                                                                                                                              |
| --------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:08 | One sentence                       | The real wordmark resolves from a close crop. The status dot wakes. Cut immediately to the agent composer with the first request ready to send.                                                                                                                                                                                                                                                                      | “A job search can take hours. The intent takes one sentence.”                                                                                                                                                                                                                                          |
| 0:08–0:23 | A website the agent can understand | Send the request. Open Jobbbler and show Chrome or ChatGPT Site tools discovering 29 actions from the live page. Give `search_jobs`, `get_job_details`, and `compare_jobs` one readable close-up.                                                                                                                                                                                                                    | “Jobbbler gives the browser agent a precise interface to the live website. No separate MCP server. No guessing which pixels to click.”                                                                                                                                                                 |
| 0:23–0:53 | Search becomes an outcome          | The agent runs the search. The visible URL, filters, count, and cards update. Activity records the completed call. It opens one full role, inspects evidence, compares two roles, and returns a concise recommendation in chat.                                                                                                                                                                                      | “The agent translates my goal into accepted filters, searches current product data, reads the complete roles, and compares the strongest matches. The page and the agent always see the same state.”                                                                                                   |
| 0:53–1:22 | Find once                          | Ask the agent to keep watching this exact search. Show the exact review in the client: criteria, schedule, masked destination, purpose, retention, and withdrawal. Approve it in the agent client. Cut to the Saved page showing the active schedule and next run.                                                                                                                                                   | “Finding the right search once is not enough. I ask Jobbbler to keep watching it. The site shows exactly what will run and where updates will go, then waits for my decision.”                                                                                                                         |
| 1:22–1:42 | Stay updated                       | Show a real completed worker run and the agent calling `get_latest_search_update`. Keep the actual new, changed, and closed counts legible in both chat and Activity.                                                                                                                                                                                                                                                | “The browser does not pretend to stay open. Jobbbler's server keeps checking after the tab closes. When I return, the agent tells me only what changed.”                                                                                                                                               |
| 1:42–2:28 | Apply with control                 | Ask the agent to apply to a clearly fictional managed role using a synthetic profile. Show the agent collecting any missing fact, requesting application assistance, and preparing truthful answers. Zoom into the exact submission review: recipient, purpose, values, and sensitivity labels. The person gives one final approval in the agent client. Show the submitted state and immutable receipt on Jobbbler. | “Now the task becomes personal. The agent can prepare the application for me, but opening the site was never permission to use my data. Jobbbler asks at the boundary that matters, shows the exact application, and submits only the unchanged version I approve. The receipt records what happened.” |
| 2:28–2:44 | The agentic web, made concrete     | Pull back to one composed frame: agent answer on the left, Jobbbler result and Activity on the right. Resolve to the wordmark and live dot.                                                                                                                                                                                                                                                                          | “This is not an AI job board. It is one website showing what changes when the web can explain its actions to the agent you already chose. Jobbbler. Find once. Stay updated. Apply with control.”                                                                                                      |

## The three real user requests

Use natural language, not tool syntax. Small wording adjustments are allowed
only if the selected client needs them to complete the verified path.

### 1. Find and compare

> Open jobbbler.com. Find senior remote platform-engineering roles in Europe
> with a disclosed salary. Compare the two strongest matches and tell me which
> one you would shortlist.

Expected visible actions include `get_search_filters`, `search_jobs`,
`get_job_details`, and `compare_jobs`. The agent may call
`plan_job_workflow`; if it does, show it briefly as guidance, not as the result.

### 2. Keep watching

> Save this search. Check it every weekday at 08:00 Europe/Berlin and email me
> only when the matches change.

Use an owned synthetic demo mailbox. If a mailbox challenge is required, keep
the code entry out of frame and cut from the exact pending review to the
activated result. The visible destination must remain masked. The recorded
delta and narration must use the counts returned by the captured run.

### 3. Apply

> Apply to the selected Jobbbler demo role. Use the synthetic profile I shared,
> write only truthful answers, and stop for my final decision before submitting.

The capture must include the real assistance request and decision, prepared
answers with agent provenance, the exact submission review, the person's final
approval, the submitted state, and the immutable receipt. Every value is
synthetic and the employer is visibly a Jobbbler demo organization.

## Composition and camera

The film uses focus shifts, not a permanently tiny split screen.

- **Agent focus:** the agent client fills roughly 70% of the frame while the
  Jobbbler page remains visible as context.
- **Product focus:** Jobbbler fills roughly 76% while the latest agent message
  remains visible as a narrow source strip.
- **Proof focus:** the product and Activity panel share the frame; the active
  tool name, safe summary, page result, and relevant URL state are readable at
  normal playback speed.
- **Decision focus:** the exact agent-client review fills the safe center; the
  product state waits in the background. After approval, the camera moves to
  the submitted state and receipt.
- **Overview:** use only at the start of a new beat and for the closing frame.

Each camera move has one reason: follow the current decision or connect a tool
call to its visible result. Use eased 350–550 ms pans and scale changes, a
maximum working zoom of about 1.55×, and a two-second reading hold after every
important result. Do not use constant parallax, elastic bounces, rapid crash
zooms, or decorative motion behind dense text.

The cursor is visible only when it explains causality. Enlarge it modestly,
keep it within the final crop, ease between measured live targets, and use a
single quiet click ring. Do not add arrows to controls the cursor already
identifies.

## Editorial graphics

On-screen editorial copy is limited to the opening thesis, three chapter
labels, one platform statement, and the closing line:

1. **One sentence**
2. **Find once**
3. **Stay updated**
4. **Apply with control**
5. **The website becomes the agent interface**

Chapter labels are small and quiet. Product evidence, not title cards, carries
the story. No shot may combine a large headline, a large subtitle block, and
dense application text.

Captions use at most two lines, sit inside a consistent lower safe zone, and
never cover the active control, tool output, result count, exact review, or
receipt. Use a compact frosted caption pane only when the underlying footage
needs separation; otherwise use dark text directly on the light film canvas.
Do not use the old full-width black subtitle box.

## Voice and sound

- Narrator: **Brian**.
- Model: ElevenLabs Multilingual v2 or the current highest-quality stable
  equivalent available to the account.
- Generate one calibrated paragraph first; lock voice settings and seed before
  producing the complete narration.
- Aim for 138–146 spoken words per minute, with short pauses before each user
  decision and after the final receipt.
- Render narration at 48 kHz. Use light cleanup only; no telephone effect,
  exaggerated bass, or synthetic room ambience.
- Music is optional and subordinate: a restrained, modern pulse without
  vocals, side-chained below narration and reduced further during exact review
  copy. Product sounds are limited to quiet send, tool-complete, decision, and
  receipt cues.
- The film must remain fully understandable with music muted and with captions
  alone.

## Capture state

Capture from the exact release revision on the canonical production origin.
Prepare one deterministic synthetic workspace before recording:

- a search that returns multiple eligible roles with disclosed salaries;
- a verified owned demo destination and a masked display value;
- an active saved search with a real completed evaluation and non-zero delta;
- a fictional managed role and a complete synthetic candidate profile;
- no unrelated Activity history, saved searches, applications, browser tabs,
  extensions, notifications, or personal account data.

Clear Agent activity immediately before the first take. Record each beat as a
separate source clip with handles. Retain the untouched source clips and a
capture log containing revision, origin, viewport, request, expected tools,
actual result, and any redaction.

## Truth and safety rules

- Use only the real WebMCP-capable client, live Site tools, production page,
  server responses, and Activity entries.
- Compositing may crop, scale, mask browser chrome, retime pauses, and place
  authentic captures in the branded frame. It may not invent a successful
  call, alter a result, rewrite an agent response, or fabricate a decision.
- Never expose cookies, OTPs, API keys, session identifiers, raw email
  addresses, provider references, database values, terminal output, or source
  payloads.
- Do not imply that WebMCP itself is a background worker or a proof of human
  identity. Jobbbler's server performs durable checks; the request-bound
  receipt records the exact approved context.
- Do not claim support for every current agent client. Show the verified client
  and state that the WebMCP interface is available to compatible browser
  agents.
- Do not compare Jobbbler to a named submission or competitor in the film.

## Acceptance criteria

The film is ready only when all of the following are true:

- runtime is under three minutes and the first ten seconds communicate the
  human value without a technical explanation;
- the real production origin and all 29 discovered Site tools are visible;
- the search request, tool activity, changed page state, comparison result,
  saved schedule, actual delta, application review, final approval, submitted
  state, and receipt are all legible and causally connected;
- the full path succeeds in one coherent synthetic workspace with no dead end,
  raw error, stale count, old UI, or contradictory narration;
- UI text remains readable at ordinary 1080p playback without pausing;
- captions, voice, tool results, and visible product state agree exactly;
- the film contains no personal data, secret, internal path, helper trace,
  debug UI, or unverified claim;
- visual QA compares representative source frames and final composite frames
  side by side at the same size, including the intro, search, saved-search,
  application review, receipt, and closing frame;
- the final H.264 file decodes cleanly, audio peaks safely below clipping, and
  the public upload plays with audio at 1080p;
- the video URL, live URL, repository revision, gallery, README, and Devpost
  copy all describe the same release.
