# WebMCP Evaluation Fixtures

The fixtures under `evals/webmcp/` test whether an external model selects the
right Jobbbler tool, supplies valid arguments, preserves order, and stops for
the person's decision. Every fixture exposes the same 28-tool list that the
production page registers on every route. Route and workflow state live in the
case context; they do not artificially hide competing tools from the model.

## Fixture contract

Each case supplies a route, stable product context, a prompt, and one expected
result:

- `tool_call` — invoke the expected `tool` with schema-valid arguments that
  preserve every material user constraint; checked-in `arguments` are the
  canonical example, not the only valid serialization;
- `clarification` — invoke nothing and cover every `mustMention` concept;
- `reject_input` — invoke nothing, identify the intended tool and invalid
  field, and explain the listed constraint.

Scoring accepts documented runtime defaults, a faithful structured category in
place of equivalent query prose, and the person's own valid location wording.
It rejects invented filters, omitted material constraints, fabricated IDs, and
decisions the person did not make. This keeps the eval semantic without making
it permissive.

Search arguments use the public criteria contract. Job IDs use the `job_`
entity format. Comparisons contain two or three unique IDs. Application
decisions require the exact server request ID and current draft version.

`plan_job_workflow` is available in every case but remains optional. Direct
requests should normally select the direct outcome tool. Planning prompts may
use it to receive a compact route-aware sequence, required inputs, and human
decision points.

## Coverage

| Fixture            | Main outcomes tested                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `search.json`      | Exact and paraphrased search, active state, opening a role, monitoring plan, vague intent, premature comparison, invalid salary range  |
| `detail.json`      | Source-backed role facts, direct managed-application preparation and planning, explicit comparison, missing target, invalid ID         |
| `compare.json`     | Current comparison, ordinal removal, addition, ambiguous ranking, unselected role                                                      |
| `saved.json`       | Alert request/decision, stale-review refusal, monitoring controls, optional recovery setup, and two-step workspace recovery            |
| `application.json` | Private application listing, readiness, request-bound assistance approval, atomic answer batch, final review, and submission decisions |

## Evaluation method

1. Load the complete 28 manifests and the case's route/state context.
2. Run direct, paraphrased, ambiguous, wrong-order, and invalid-input prompts.
3. Score tool selection, argument accuracy, safe sequencing, and refusal to
   invent a human decision.
4. Run weak/low-effort and stronger/default models. Fix ambiguous tools or
   schemas, not a single model with narrow negative prompt patches.
5. Deterministic tests still own tool logic, atomicity, output size, and UI
   synchronization; probabilistic evals own model routing quality.

## Current deterministic release inventory — 30 August 2026

The checked-in set contains 50 uniquely identified cases against the current
28-tool surface: 28 direct, 7 paraphrased, 5 ambiguous, 5 wrong-order, and 5
invalid-input prompts. Every public tool is the expected outcome of at least one
case; inventory lists alone do not count as coverage. The public application
cases now use one direct Jobbbler-managed path: `prepare_application` creates or
reopens the private application, and the separate assistance and submission
tools preserve the person's decisions. The fixtures also cover optional
`enable_workspace_recovery`, a bounded private `get_applications` page, and both
phases of `recover_jobbbler_workspace` without requiring the person to visit a
form.

Earlier model-tuning and handler-execution runs informed the descriptions,
schemas, output bounds, and comparison sequencing, but they exercised prior
tool inventories. They are not presented as results for this 28-tool release
surface. Any published model score must come from a fresh run of these exact
fixtures. Deterministic suites separately verify schemas, execution,
cancellation, bounded output, UI synchronization, storage atomicity, and builds.

The judge demo should show one natural-language search, one comparison, one
saved-search delta, and the application sequence from assistance request through
the exact final submission review. It ends with that decision pending; the judge
does not approve or decline it. No fixture, model, or agent may self-approve
consent or claim an application was submitted without the exact approved
request.
