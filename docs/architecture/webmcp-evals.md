# WebMCP Evaluation Fixtures

The fixtures under `evals/webmcp/` test whether an external model selects the
right Jobbbler tool, supplies valid arguments, preserves order, and stops for
the person's decision. Every fixture exposes the same 26-tool list that the
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

| Fixture            | Main outcomes tested                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `search.json`      | Exact and paraphrased search, active state, opening a role, monitoring plan, vague intent, premature comparison, invalid salary range   |
| `detail.json`      | Source-backed role facts, application capability and mode-aware planning, explicit comparison, missing target, invalid ID               |
| `compare.json`     | Current comparison, ordinal removal, addition, ambiguous ranking, unselected role                                                       |
| `saved.json`       | Agent-native alert request and decision, missing or stale review refusal, alert reading, pause, reopen, latest delta, recovery planning |
| `application.json` | Readiness, request-bound assistance approval and withdrawal, atomic answer batch, final review, and isolated submission decisions       |

## Evaluation method

1. Load the complete 26 manifests and the case's route/state context.
2. Run direct, paraphrased, ambiguous, wrong-order, and invalid-input prompts.
3. Score tool selection, argument accuracy, safe sequencing, and refusal to
   invent a human decision.
4. Run weak/low-effort and stronger/default models. Fix ambiguous tools or
   schemas, not a single model with narrow negative prompt patches.
5. Deterministic tests still own tool logic, atomicity, output size, and UI
   synchronization; probabilistic evals own model routing quality.

## Current pre-release model pass — 30 August 2026

- Luna at low effort: 50/50 independent decisions against the current global
  26-tool surface. The set contains 25 direct, 7 paraphrased, 5 ambiguous, 8
  wrong-order, and 5 invalid-input cases. Every tool is the actual expected
  outcome of at least one case; inventory lists alone do not count as coverage.
- Terra at medium effort: 10/10 end-to-end workflows. These covered broad-search
  clarification, comparison, managed application assistance, exact pending
  submission review, external-employer stop, alert request plus mailbox
  approval, decline, missing/wrong-code recovery, alert pause/resume/latest
  update, and arbitrary-page recovery.
- Both models kept consent and submission decisions with the person, used only
  server-returned IDs and tokens, never invented a mailbox code, and did not
  claim that an external employer received an application.

The run found no routing or schema ambiguity. Terra did identify one useful
recoverability refinement: an incorrect mailbox code and an expired alert review
should be distinguishable through a typed safe error, rather than requiring the
agent to interpret message text. That is a result-contract improvement, not a
reason to weaken the approval boundary.

These are isolated model-judgment runs, not production telemetry. The checked-in
deterministic suites separately verify schemas, execution, cancellation,
bounded output, UI synchronization, storage atomicity, and builds.

### Earlier tuning pass

An earlier 24-tool Luna pass initially scored 48/50 because two attempts tried
to compare before two exact role IDs existed. Tightening the `compare_jobs`
contract produced 50/50 on re-run. Those historical numbers are retained only
as evidence that the descriptions were iterated; they are not substituted for
the current 26-tool results above.

The judge demo should show one natural-language search, one comparison, one
saved-search delta, and the application sequence from assistance request through
the exact final submission review. It ends with that decision pending; the judge
does not approve or decline it. No fixture, model, or agent may self-approve
consent or claim an external employer received an application.
