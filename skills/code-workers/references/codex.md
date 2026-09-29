# Codex adapter

Verified against official documentation on 2026-09-28:
[Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[Skills](https://learn.chatgpt.com/docs/build-skills).
Current runtime tools and configuration take precedence over these examples.

## Capability and definition

Verify native spawn plus result/continuation tools are available, custom role files
are supported, and the exact selected model/effort are allowed. Do not enable
multi-agent settings automatically. Missing capability stops setup.

The generator writes `code_worker.toml` under `$CODEX_HOME/agents` (default
`~/.codex/agents`) or `<project>/.codex/agents`. Required fields are `name`,
`description`, `developer_instructions`; model is explicit. `--effort` maps to
`model_reasoning_effort`. The role identity is `code_worker`.

Custom-file model/effort take precedence over the resolved spawn settings in the
documented version. Resolution before that file uses explicit spawn values, agents
defaults, then the parent. Inspect the real role and effective settings; an explicit
spawn override cannot be assumed to defeat a file override. Set compatible effort
when the parent/default would otherwise carry an incompatible level. Inherit the
host's permission boundaries; the template does not grant broader sandbox access.

## Dispatch and collect

Use the actual spawn schema to select `code_worker`. Where available, request a
clean context (`fork_turns: "none"`). Pass the task packet and exact model/effort
only where the schema permits; a fixed-model role may reject a model override.
Never copy older spawn syntax merely because it appears in documentation.

Record the returned child id, collect completion through the native event/wait
mechanism, inspect changes and checks. Continue a scoped correction using the
exposed continuation tool (such as `followup_task`); do not assume a message to an
idle child starts another turn unless the current tool says it does. Honor the
current concurrency limit and lifecycle; do not invent a close-agent call.

After writing a role, start a fresh session when discovery requires it. File
parsing is configuration evidence; seeing the role and successfully dispatching it
are separate runtime evidence. The existing personal `code_worker` should be reused
if suitable; a differing definition is not overwritten without an update request.
