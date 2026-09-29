# Pi adapter

Verified 2026-09-28 against Pi's official
[subagent example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent)
and [agent loader](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/agents.ts).
This is an **extension-dependent** adapter, not a claim that every Pi installation
ships a native subagent tool. An incompatible third-party extension must not be
treated as this loader merely because its tool is called subagent.

## Capability and definition

Confirm the compatible extension is already loaded, its tool can dispatch writable
workers with model selection, and the chosen model route is available. Missing
extension means installation error and rollback if necessary. Do not install one,
launch `pi` as an improvised subprocess, or switch to another harness.

Generate `code-worker.md` in `$PI_CODING_AGENT_DIR/agents` (default
`~/.pi/agent/agents`) or `<project>/.pi/agents`. YAML declares name, description
and explicit model; the loader's model field may contain a provider/model route.
The verified loader has no independent effort field. `--effort` is rejected rather
than silently discarded. Inspect the extension's actual effective thinking level.

## Dispatch and collect

The official example exposes single `{agent, task}`, parallel `{tasks: [...]}` and
chain `{chain: [...]}` shapes. Use the installed schema, not this sketch as a fixed
API. Default discovery is user-only; a project installation also requires the
supported `agentScope: "project"` or `"both"` with a trusted project. Check this
before claiming that a project definition is usable.

Each example invocation launches an isolated worker. Parallel limits belong to
the extension; do not exceed them. Collect the returned result and failure details.
The example does not promise a resumable conversation interface: use native resume
only if the installed extension supports it, otherwise send a compact correction
packet to a new invocation. Never simulate continuation by copying the whole chat.

The example discovers definitions on invocation. Verify actual discovery and a
minimal read-only result; do not label an arbitrary matching Markdown file as loaded.
