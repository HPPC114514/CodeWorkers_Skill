---
name: code-workers
description: Use when coordinating coding tasks with a capable planner and explicitly selected lower-cost workers, or creating reusable worker definitions across coding harnesses.
---

# Code Workers

The main session owns requirements, technical decisions, task decomposition and
acceptance. Workers implement bounded assignments. Keep the user's selected
models and validation restrictions. This skill never switches the parent model.

**Worker entry:** If you are an assigned implementation worker, stop reading this
orchestration workflow. Follow your assignment and worker instructions; do not
delegate or load more orchestration skills.

## Select the adapter

Identify the current harness from actual tools/session information, not directory
names alone. Read **only** its reference:

| Harness | Reference |
|---|---|
| Codex | [codex.md](references/codex.md) |
| Claude Code | [claude-code.md](references/claude-code.md) |
| Antigravity | [antigravity.md](references/antigravity.md) |
| OpenCode | [opencode.md](references/opencode.md) |
| Pi | [pi.md](references/pi.md) |
| DeepSeek Harness (DSH) | [dsh.md](references/dsh.md) |
| ZCode | [zcode.md](references/zcode.md) |
| Other | [generic.md](references/generic.md) |

Actual tool schemas, model availability and host instruction priority govern.
If setup is requested or no suitable worker exists, read
[setup.md](references/setup.md). Reuse a verified existing definition when its
prompt, model and permissions match. Record the selected worker model once;
never silently inherit the parent model or upgrade to an expensive worker.

## Plan and dispatch

1. Inspect the relevant code and resolve decisions that affect observable behavior.
   Use the current approved plan; fill concrete gaps without restarting planning.
2. Group related small edits into bounded tasks. Serialize overlapping writes and
   dependencies. Parallelize only independent assignments with disjoint ownership,
   within the host's actual capacity.
3. Send a self-contained [task packet](references/task-packet.md) with goal, context,
   write scope, settled technical decisions, acceptance criteria and permitted
   validation. Missing essential decisions require planning, not invented worker
   requirements. Empty optional fields alone are not a blocker.
4. Start the selected worker with clean context where supported. Pass exact file
   pointers or necessary excerpts, not the whole transcript. Give shared-workspace
   workers explicit ownership and instructions to preserve others' edits.
5. Collect results through the native completion mechanism. Continue independent
   planner work while workers run; avoid repeated status polling. Preserve child
   identifiers for follow-up. Resume the same worker for a scoped correction when
   the harness supports it; otherwise hand the next worker a compact evidence packet.

## Accept or repair

Inspect the actual changes against the acceptance criteria and observed checks.
`complete` is a worker report, not independent evidence. Pending CI stays pending;
CI-only forbids local tests. Use `complete | partial | blocked` and distinguish
implementation progress from verification.

For a blocker, obtain the evidence and smallest required decision, then revise the
assignment or continue unaffected tasks. Retry only with changed inputs/evidence
or a bounded transient retry. Stop loops without progress. Keep model upgrades
under explicit user control; do not create a separate reviewer tier by default.

Missing delegation, model control or installation prerequisites means **report the
error and stop the affected workflow**. Roll back this installation's changes using
its receipt if any were made. Do not install extensions, launch another harness,
or have the flagship implement the task as an automatic fallback.
