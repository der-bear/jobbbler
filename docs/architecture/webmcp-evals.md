# WebMCP Evaluation Fixtures

The fixtures under `evals/webmcp/` test whether an external model selects the
right Jobbbler tool, supplies valid arguments, preserves order, and stops for
the person's decision. Every fixture exposes the same 24-tool list that the
production page registers on every route. Route and workflow state live in the
case context; they do not artificially hide competing tools from the model.

## Fixture contract

Each case supplies a route, stable product context, a prompt, and one expected
result:

- `tool_call` — invoke exactly `tool` with deep-equal `arguments`;
- `clarification` — invoke nothing and cover every `mustMention` item;
- `reject_input` — invoke nothing, identify the intended tool and invalid
  field, and explain the listed constraint.

Search arguments use the public criteria contract. Job IDs use the `job_`
entity format. Comparisons contain two or three unique IDs. Application
decisions require the exact server request ID and current draft version.

`plan_job_workflow` is available in every case but remains optional. Direct
requests should normally select the direct outcome tool. Planning prompts may
use it to receive a compact route-aware sequence, required inputs, and human
decision points.

## Coverage

| Fixture            | Main outcomes tested                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `search.json`      | Exact and paraphrased search, active state, opening a role, monitoring plan, vague intent, premature comparison, invalid salary range |
| `detail.json`      | Source-backed role facts, application capability, explicit comparison, missing target, invalid ID                                     |
| `compare.json`     | Current comparison, ordinal removal, addition, ambiguous ranking, unselected role                                                     |
| `saved.json`       | Alert reading, pause or resume by exact schedule ID, reopen criteria, latest delta, ambiguous alert, unknown schedule                 |
| `application.json` | Readiness, assistance request and exact decision, atomic answer batch, final review, approved or declined exact submission            |

## Evaluation method

1. Load the complete 24 manifests and the case's route/state context.
2. Run direct, paraphrased, ambiguous, wrong-order, and invalid-input prompts.
3. Score tool selection, argument accuracy, safe sequencing, and refusal to
   invent a human decision.
4. Run weak/low-effort and stronger/default models. Fix ambiguous tools or
   schemas, not a single model with narrow negative prompt patches.
5. Deterministic tests still own tool logic, atomicity, output size, and UI
   synchronization; probabilistic evals own model routing quality.

## Pre-release model pass — 30 August 2026

- Luna at low effort: 50 isolated routing decisions. The first pass scored
  48/50; both misses tried to compare before two exact role IDs existed. After
  the `compare_jobs` description was tightened to forbid one-role calls, the
  two cases were re-run and the final result was 50/50.
- Terra at medium effort: 10/10 end-to-end routing decisions, including alert
  disambiguation, assistance authorization, batched application preparation,
  and the exact final submission decision.
- A follow-up pass confirmed that `prepare_application` creates or reopens a
  draft but grants no preparation authority, while `open_jobbbler_page` clearly
  separates the Applications list from an exact private application.

These are isolated model-judgment runs, not production telemetry. The checked-in
deterministic suites separately verify schemas, execution, cancellation,
bounded output, UI synchronization, storage atomicity, and builds.

The judge demo should show one natural-language search, one comparison, one
saved-search delta, and the application sequence from assistance request to an
exact final decision. No fixture, model, or agent may self-approve consent or
claim an external employer received an application.
