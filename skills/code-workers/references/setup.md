# Setup, installation and rollback

Use this reference only when creating/updating a worker. Normal dispatch reuses the
verified worker and reads the current adapter, not this setup procedure.

## Preflight before mutations

1. Identify the actual harness and installed version; inspect its currently exposed
   delegation and result tools. Verify that native definitions are supported and
   that the selected definition's model will take effect, including forced overrides.
2. Choose an explicit worker model with the user once, then reuse it. Resolve the
   current provider/model or tier and compatible effort from observable configuration,
   tools or the native model catalog. An example model in a document is not evidence
   of account access. Do not infer cheapness from a model name alone.
3. Resolve the target with the adapter's documented discovery location. User scope
   is the default. Inspect existing definitions: matching instructions/model can be
   reused; a different same-name file is a conflict unless its update is requested.
4. Confirm all adapter-specific prerequisites. No missing extension, provider,
   directory format, or model may be fixed by automatically installing dependencies.
   A missing runtime capability stops installation with an error, before any writes.
5. Record the observations below. The JSON is a planner's attestation, **not an
   automatic detector, permission grant or proof of a successful model invocation**.
   Never set a flag to true without a concrete observation. Unconfirmed means stop.

The CLI uses Node.js 20+ built-ins only. No `npm install` is needed by skill users.
Invoke via `node <skill-directory>/scripts/worker.mjs`; working directory need not
be the skill directory. Default targets respect CODEX_HOME, CLAUDE_CONFIG_DIR,
XDG_CONFIG_HOME, PI_CODING_AGENT_DIR and DSH_HOME as applicable. Explicit `--home`
does not erase those environment overrides; check the resulting absolute target.
Use `--project-root` with `--scope project` to select a project deliberately.

## Preflight record

Save a JSON file containing schemaVersion 1, the current ISO timestamp `checkedAt`,
exact `harness`, normalized `model`, `scope`, absolute `target`, `modelAvailable`,
`capabilities`, and a nonempty list of concrete `evidence` observations. Include
`provider`, `effort` and `profile` exactly when supplied to the CLI.

Common required capability keys: `delegation`, `modelSelection`, `definitionFormat`.
All must be true. `modelAvailable` must be true. Additional keys:

| Condition | Required observation |
|---|---|
| An explicit effort | `reasoningSelection`: chosen effort supported by that route |
| OpenCode effort | Top-level `reasoningField` equals `reasoningEffort`, confirmed for this provider/model |
| Pi | `extensionAvailable`: compatible subagent extension is already active |
| Antigravity | `toolsMapped`: exact worker tools available; top-level `tools` equals CLI list |
| DSH | `existingProfile`, `spawnProvider`, `persona`, `agentOptions`, `depthLimit`, `toolPackageAvailable`, `patchValidated` |

Records expire after one hour and bind to one exact destination/configuration.
Recheck after runtime/model/config changes even within that hour. Do not put API
keys, token values or complete configuration dumps in evidence. Tests use synthetic
records inside temporary homes; do not reuse them for a real installation.

For DSH, also record SHA-256 `candidateSha256` of the **full merged UTF-8 patch**
whose syntax/compatibility you checked. Use `render --merge-profile` to preview it.
Verify the composition using the installed schema/loader without evaluating arbitrary
YAML `!!js` expressions. A DSH config dump may initialize profiles, so never run
one against a missing profile as a supposedly read-only probe.

## Operations

```sh
# Offline preview only. Select a real model during setup.
node scripts/worker.mjs render --harness codex --model gpt-6-luna --effort medium

# Run from the skill directory after completing the observations above.
node scripts/worker.mjs install --harness codex --model gpt-6-luna --effort medium --preflight /absolute/path/preflight.json

# Only when the user requested updating an existing, different definition:
node scripts/worker.mjs install --harness codex --model gpt-6-luna --effort medium --preflight /absolute/path/preflight.json --replace

# Use the actual receipt path printed by installation.
node scripts/worker.mjs rollback --receipt /absolute/path/receipt.json
```

`render` prints the template to stdout, requires no running harness, and does not
prove availability. Unknown harnesses render a portable handoff only. Their native
installation has no guessed target and is rejected; use the generic workflow after
verifying the host's actual tools.

`install` preflights the complete file set, journals original bytes, writes
transactionally and checks readback. It reports `installed_pending_reload` or
`unchanged`, plus the receipt. The default journal is `~/.code-workers/transactions`;
`--state-dir` changes it explicitly. Retain receipts for recovery; they contain old
configuration contents, so do not publish them or commit them to a repository.

Confirm the worker appears in the native role list in a new session, resolves to
the chosen model/effort, and can complete a minimal authorized read-only task.
Where the host cannot expose effective routing, report that limitation rather than
claiming measured cost savings. A normal reload requirement is a pending check,
not a failed installation. If a native check actually fails, invoke `rollback` and
stop setup. Do not continue dispatching through a different model or harness.

Rollback restores only this transaction's files and removes its empty directories.
It refuses to erase later user modifications and reports recovery conflicts. If
automatic or explicit rollback fails, preserve the receipt and report both the
original error and recovery failure; do not describe partial recovery as success.

The installer rejects symlink/junction target ancestry and non-regular files.
Choose a confirmed real discovery path instead of bypassing this check. Cooperative
installs share per-target locks under the current user's canonical temporary
directory, regardless of journal location. After a process interruption, recover
the old transaction with its receipt before attempting another installation.
