# Claude Code adapter

Verified 2026-09-28 against [Custom subagents](https://code.claude.com/docs/en/sub-agents)
and [Skills](https://code.claude.com/docs/en/skills).

## Capability and definition

Confirm the current Agent/delegation tool, native custom definitions and the chosen
model are available. Inspect any effective model override, including environment
policies that force all subagents to one model; do not silently bypass that policy.

Generate `code-worker.md` in `$CLAUDE_CONFIG_DIR/agents` (default `~/.claude/agents`)
or `<project>/.claude/agents`. The YAML fields are `name`, `description`, explicit
`model`, and optional `effort` if supported by the installed version and model.
The Markdown body is the shared worker prompt. No permission-mode override, hook,
MCP reconfiguration or compulsory tool allowlist is installed.

Model aliases and full ids have different resolution behavior; record the selected
route and check it at dispatch. `inherit` is not a Code Workers model choice.
Per-invocation model selection can override frontmatter in the documented version,
so the planner must keep it consistent with the saved worker choice.

## Dispatch, collect and continue

Invoke the named worker through the current native tool with the compact task
packet. Subagents have their own context; do not paste the parent transcript.
Collect a foreground result or the exposed background completion/result surface.
Record the child identifier. Use native resume support for corrections when it is
actually present; otherwise start a new worker with the diff, failure evidence and
remaining acceptance criteria. Do not promise persistence from a plain file name.

Verify the role is discovered in a new session, its effective model is the selected
one, and its read-only smoke task returns normally. A saved Markdown file alone is
not a runtime test. Use the install receipt to roll back an actual discovery error.
