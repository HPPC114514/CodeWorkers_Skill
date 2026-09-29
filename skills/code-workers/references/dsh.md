# DeepSeek Harness (DSH) adapter

Verified 2026-09-28 against official
[delegation configuration](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/tool-subagent/README.md),
[CLI/profile behavior](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md),
and [bundle patch format](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/base/cordis.patch.yml).

## Capability and definition

Select an **existing** user profile. Verify the subagent service, the `spawn`
in-process provider and `@deepseek-ai/dsh-tool-subagent` package are already
available. Verify this provider supports `persona`, `agentOptions` and depth
limits. No missing package or profile is initialized by Code Workers.

DSH templates are Cordis patch entries, not Markdown roles. The generator appends
a dedicated managed `insert` row to
`$DSH_HOME/profiles/<profile>/cordis.patch.yml` (default home `~/.dsh`). The row
registers `code_worker` over provider `spawn`, fixes `agentOptions.provider/model`
and optional `reasoningEffort`, embeds the shared persona, sets `maxDepth: 1`,
and disables dynamic model selection for this entry. `--provider` is the LLM
provider; it is distinct from the subagent backend `spawn`.

Existing configuration bytes are preserved; only the managed block is replaced on
explicit update. The CLI supports block-sequence or empty/comment-only patch files;
flow sequences and document markers stop installation rather than rewriting user
YAML. Review the merged candidate and its native compatibility as described in
[setup.md](setup.md). DSH's `!!js` dialect must not be evaluated by a generic YAML
validator. Remember profile dumps can initialize missing profiles.

## Dispatch and collect

Use the actual registered `code_worker` tool with its declared task/prompt fields.
The generated entry is one-shot, providing a foreground result by default. If
background execution is exposed and selected, use the advertised job id/result
collector; “started” is not completion. Avoid the built-in fork route for this
workflow: it may inherit the flagship route and copied context.

This adapter does not promise continuation for a one-shot job. Resume only when a
separately verified native continuation interface exists; otherwise provide a new
worker with the correction packet. Preserve the configured model choice.

After a required reload, verify tool registration and effective worker route.
An unavailable service, load failure or incompatible schema triggers rollback and
stops setup. Do not mount extra providers as a recovery tactic.
