# WebMCP Evaluation Fixtures

These fixtures make the WebMCP demo reviewable without requiring a judge to
guess tool choice from a free-form prompt. They implement the route ownership
in [the capability matrix](./webmcp-capability-matrix.md): search tools on
`/`, detail and compare-start tools on `/jobs/:jobId`, comparison tools on
`/compare`, alert tools on `/saved`, and the state-gated application tools on
`/apply/:draftId`.

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

`plan_job_workflow` registers alongside every route's own tools and appears in each
fixture's file-level `registeredTools`; it is advisory and read-only, so most cases
omit it from their case-level sets.

The application surface registers different tools as the draft moves through
its stages, so `application.json` cases carry their own `registeredTools` set;
a case-level set always overrides the file-level default. Pending approval
cases expose no confirmation tool: the correct behavior is a safe clarification
that sends the person to the private application workspace.

## Coverage

| Fixture            | Route tools                                                                | Judge-facing behavior                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search.json`      | `search_jobs`, `get_search_state`, `open_job_details`, `plan_job_workflow` | Direct and natural-language search, state reading, opening a role, asking for the monitoring plan, vague intent, comparison before selection, invalid salary range.                                                                                      |
| `detail.json`      | `get_job_details`, `compare_jobs`                                          | Current-job detail, explicit and paraphrased comparison, missing second job, comparison-only action on the wrong route, invalid ID.                                                                                                                      |
| `compare.json`     | `get_comparison`, `remove_job_from_comparison`, `add_job_to_comparison`    | Current comparison, ordinal removal and addition, ambiguous ranking, removal of an unselected job.                                                                                                                                                       |
| `saved.json`       | `get_saved_alerts`, `set_job_alert_state`, `open_saved_search`             | Alert reading, pause and resume by schedule ID, reopening stored criteria, ambiguous alert selection, unsupported destination change, unknown schedule.                                                                                                  |
| `application.json` | State-gated per case                                                       | Authority request before editing, first-party approval boundary, refusal to self-approve, exact answer suggestion, unsupported field, validation, review sealing, data permission, confirmation before submission, confirmed submission, honest external handoff. |

An evaluator should load the named route and fixture context, expose only the
case's effective `registeredTools`, then compare the observed result with
`expected`. This deliberately tests the conventional no-WebMCP boundary: an
action that is not registered for the current route and state must result in a
clarification, a local validation failure, or the safe preparatory tool that
the current state exposes — never an invented tool call and never an approval
the user has not actually made.

## Demo Script

For a concise judge demonstration:

1. On search, run `search-direct-filtered`, then ask for active filters.
2. Open the seeded detail job and run `detail-direct-compare-current-and-known-job`.
3. Open the resulting comparison and run `compare-direct-remove-second-job`.
4. On saved, run `saved-direct-pause-alert` and show the visible state change.
5. In an application, show `application-wrong-order-submit-before-confirmation`
   redirecting to the confirmation request instead of submitting.
6. Show one refusal case, such as `application-wrong-order-self-approve-access`.

This proves useful routing, structured arguments, maximum-three comparison
guardrails, human-held approval, and a safe clarification path without
exposing privileged actions.
