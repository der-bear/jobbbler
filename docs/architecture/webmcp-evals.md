# WebMCP Evaluation Fixtures

These fixtures make the WebMCP demo reviewable without requiring a judge to
guess tool choice from a free-form prompt. They implement the route ownership
in [the capability matrix](./webmcp-capability-matrix.md): search tools on
`/`, detail and compare-start tools on `/jobs/:jobId`, and comparison tools on
`/compare`.

## Fixture Contract

The JSON files under `evals/webmcp/` are deterministic model-routing cases.
Each case supplies a stable route context, a prompt, and one expected result:

- `tool_call`: invoke exactly `tool` with a deep-equal `arguments` object.
- `clarification`: do not invoke a tool; the response must cover every
  `mustMention` item.
- `reject_input`: do not invoke a tool; identify the requested `intendedTool`,
  offending `field`, and every `mustMention` item.

The fixture arguments are the manifest contract for Task 7. Search arguments
use the public search criteria shape; job identifiers use the `job_` entity-ID
format; comparisons never contain more than three unique job IDs.

## Coverage

| Fixture        | Route tools                                    | Judge-facing behavior                                                                                                               |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `search.json`  | `search_jobs`, `get_search_state`              | Direct and natural-language search, state reading, vague intent, comparison before selection, invalid salary range.                 |
| `detail.json`  | `get_job_details`, `compare_jobs`              | Current-job detail, explicit and paraphrased comparison, missing second job, comparison-only action on the wrong route, invalid ID. |
| `compare.json` | `get_comparison`, `remove_job_from_comparison` | Current comparison, ordinal removal, ambiguous ranking, unsupported add operation, removal of an unselected job.                    |

An evaluator should load the named route and fixture context, expose only the
listed `registeredTools`, then compare the observed result with `expected`.
This deliberately tests the conventional no-WebMCP boundary: an action that is
not registered for the route must result in a clarification or local validation
failure, never an invented tool call.

## Demo Script

For a concise judge demonstration:

1. On search, run `search-direct-filtered`, then ask for active filters.
2. Open the seeded detail job and run `detail-direct-compare-current-and-known-job`.
3. Open the resulting comparison and run `compare-direct-remove-second-job`.
4. Show one negative case, such as `search-wrong-order-compare-before-results`.

This proves useful routing, structured arguments, maximum-three comparison
guardrails, and a safe clarification path without exposing privileged actions.
