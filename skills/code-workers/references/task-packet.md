# Task packet and acceptance

Send the following compact contract, filled with actual decisions. References may
replace excerpts when the worker can read them. Do not paste unrelated plan sections.

```text
Goal: <observable result>
Context: <necessary code paths, callers, current behavior, relevant evidence>
Write scope: <owned files/modules; explicitly permitted additions>
Decisions: <chosen API, algorithm, dependency and compatibility choices>
Acceptance: <concrete success cases, failures and boundary cases>
Validation: <required commands/CI job, allowed execution and restrictions>
Coordination: <dependencies and existing edits; do not revert others' work>
Handoff: status: complete | partial | blocked
         changes: files and implemented behavior
         verification: observed checks; pending/omitted checks and reasons
         unresolved: remaining requirements or decisions; otherwise none
```

The worker may inspect related files beyond its write scope, resolve routine
implementation details and perform authorized self-validation. It does not choose
new public contracts or research an undefined architecture. It reports evidence
when the specification is invalid. It never spawns another worker.

## Example

```text
Goal: Reject an empty item id before the existing lookup.
Context: src/items.ts:getItem; the current lookup receives empty strings.
Write scope: src/items.ts and tests/items.test.ts.
Decisions: Keep getItem's existing signature and Error type. Reject only the
           empty string with message "Item id is empty"; preserve whitespace ids.
Acceptance: Empty input throws before lookup; nonempty behavior stays unchanged.
Validation: CI-only; update the focused cases but do not run local tests.
Coordination: This task owns these files; preserve pre-existing edits. No new
              dependency or public API changes. Report a conflict to the Planner.
Handoff: Use status/changes/verification/unresolved; pending CI is not complete.
```

Acceptance is a planner decision based on the diff and verification evidence. If
the user specifies a different output format, preserve that format instead of
adding this report. Keep model selection/configuration out of product source code.
