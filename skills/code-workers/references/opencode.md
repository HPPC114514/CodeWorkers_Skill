# OpenCode adapter

Verified 2026-09-29 against [Agents](https://opencode.ai/docs/agents/)
and [Agent skills](https://opencode.ai/docs/skills/).

## Capability and definition

Verify native task delegation, custom Markdown agents, and the exact provider/model
route. The skill keeps the current main session as planner; OpenCode's restricted
Plan mode is not a way to authorize worker mutations. Respect active host mode and
permissions before any execution.

Generate `code-worker.md` under `$XDG_CONFIG_HOME/opencode/agents` (default
`~/.config/opencode/agents`) or `<project>/.opencode/agents`. Its frontmatter has
`description`, `mode: subagent`, and explicit `model: provider/model`. The filename
is the native identity. `--provider` can supply the prefix when `--model` is a
bare ID; conflicting prefixes are rejected.

`--effort` maps to the documented provider option `reasoningEffort`. Verify that
the chosen route accepts that field/value and record `reasoningField: reasoningEffort`
in preflight. Providers requiring different thinking schemas are unsupported by
this mapping: stop rather than silently ignoring or converting the setting.
No global permissions or default primary-agent settings are changed.

## Dispatch and collect

Use the current native Task/delegation tool and `code-worker` identity, or its
supported manual mention. Pass the task packet, not the parent transcript. Native
subagent sessions can differ from the current UI session; retain the returned task
or session identifier and collect the actual result through the available API.

Reuse a resumable task/session for a correction when the current schema exposes
that capability. Otherwise supply a concise handoff to a new worker. Serializing
tasks that touch the same files is required even if parallel invocation is possible.

After installation, verify role discovery and the effective provider/model before
accepting a read-only smoke result. Restart when the installed version requires it;
roll back a real load failure with the receipt.
