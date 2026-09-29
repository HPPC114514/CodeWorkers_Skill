# ZCode adapter

Verified 2026-09-28 against [Subagents](https://zcode.z.ai/en/docs/subagents)
and [Skills](https://zcode.z.ai/en/docs/skill).

## Capability and definition

Confirm custom subagents are enabled in the installed version, the Agent tool is
available, and the selected model and thinking level are supported. This beta
format currently documents user scope only. Project scope is an error, not an
invitation to invent a `.zcode/agents` discovery path in a repository.

Generate `~/.zcode/agents/code-worker.md` with YAML `name`, `description`, explicit
`model` and optional `thoughtLevel`. The field is camelCase: `reasoningEffort`
would not set this value. Omit permission overrides so the host's actual policies
apply. The prompt preserves the no-nesting and scoped-implementation boundaries.

## Dispatch and collect

Use the installed Agent tool to select `code-worker` with the task packet. Its
context is separate. Track the child/session identifier and native foreground or
background result; verify actual changes and observed checks before acceptance.
Do not confuse a background Explore agent with a writable implementation worker.

Continue a scoped correction only through an exposed native continuation feature.
If none is available, create another isolated invocation with the current diff and
remaining requirements. ZCode subagents cannot spawn their own subagents in the
documented runtime; the workflow also prohibits that independently.

Definition and model/effort edits require a new session in the documented version.
Report pending reload distinctly from errors. Verify discovery and routing after
restart; roll back this transaction when a native load/check actually fails.
