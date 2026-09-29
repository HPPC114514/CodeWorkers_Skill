# Code Workers implementation record

Approved scope: the user-approved plan in this chat, implemented in this repository.
Runtime: independent skill, seven named adapters plus generic rules, Node built-ins.
Installation: explicit worker model, user scope by default, capability checks before
mutation, conflict detection, durable rollback. No auto-installed dependencies or
model upgrades. Original source prompt remains unchanged.

## Work and verification

- [x] Baseline behavioral scenarios, without the new skill.
- [x] Portable renderer, seven adapters, generic output, command interface.
- [x] Durable transactional installer and rollback tests.
- [x] Skill entrypoint, selective references, Chinese usage documentation.
- [x] Behavioral scenarios with skill; independent code review and fixes.
- [x] Full local test suite, existing Codex role invocation, final report.

## Interface and scope review

| Parts | Shared contract | Ruling |
|---|---|---|
| Renderer / installer | Absolute target + UTF-8 content; installer owns filesystem mutations | Keep rendering pure; no subprocess installation |
| Skill / CLI | A current, exact configuration-bound preflight attestation | Attestation records observations, not proof manufactured by a script |
| DSH / installer | Existing profile patch gets an appended managed block | Preserve original bytes, refuse an unmanaged conflicting block |
| Worker prompt / platform templates | Packaged asset is the sole runtime prompt source | Original root file retained as provenance |
| Checks / installation | File validity and native discovery are distinct | Pending reload is reported explicitly; actual check failure rolls back |
| Workspace | User requested delivery in this repository; original input is untracked | Work in place on a local feature branch, retain input |

No runtime dependency on Superpowers. Behavioral testing and review use its authoring
workflow only. No commit, push, or installation into personal harness state is part
of this delivery.
