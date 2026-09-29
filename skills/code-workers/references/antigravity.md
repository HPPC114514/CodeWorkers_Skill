# Antigravity adapter

Verified 2026-09-28 against [Custom subagents](https://antigravity.google/docs/subagents?tab=cli).
This applies to documented Antigravity 2.0/CLI custom agents. Older IDE-only
workflows must pass the same capability checks; the name alone is not sufficient.

## Capability and definition

Confirm native `invoke_subagent` (or its documented current equivalent), custom
Markdown definitions, and the selected model tier. The verified fields support
explicit `flash` or `pro`; concrete provider model IDs from other harnesses do not
belong here. This adapter rejects `--effort`, which has no verified independent
field in this format. Check that the user's selected tier suits the cost goal.

Generate `code-worker.md` in `~/.gemini/config/agents` or
`<project>/.agents/agents`. Set `mainAgent: false`, `subagent: true`, `model`, and an
explicit `tools` list. Resolve exact read/search/edit/command tool names from the
installed environment; pass them with `--tools name,name`. Record this same list
in preflight. Do not copy misspelled names or introduce permissions the parent lacks.

## Dispatch and collect

Invoke the defined worker with the task packet. Its context starts fresh. Select
the appropriate native workspace mode: shared edits require disjoint file
ownership; isolated worktrees require the planner to inspect and integrate the
result. Do not create additional worktrees merely to instantiate a template.

Track the returned id and native running/idle/killed states. Collect the actual
result before acceptance. A native message can reawaken an idle agent in the
documented version; killed agents cannot be resumed. Recheck the actual tool
semantics and never guess a tool invocation from a name.

Verify discovery and model tier in a new session after installation as needed.
Roll back failed native checks; do not fall back to a different tier automatically.
