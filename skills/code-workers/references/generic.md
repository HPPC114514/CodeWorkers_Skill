# Other harnesses

No native configuration schema or dispatch API is assumed.

Inspect the current tool schemas and authoritative documentation for these minimum
capabilities: delegated execution, an explicit selected worker model, a way to
supply the worker instructions/task packet, and a way to collect completion.
Map continuation and concurrency only when supported. A directory resembling
another harness is not capability evidence.

If these capabilities exist, use the same planner/worker contract and acceptance
rules through those tools. `render --harness <name> --model <id>` produces a portable
handoff containing the chosen model and worker prompt, not an installable native
definition. Pass the prompt through the supported instruction surface; state when
that surface has lower priority than a native system/developer role.

If the native definition format or discovery path is unknown, the generator's
`install` operation stops. Do not copy another harness's files into guessed paths.
If delegation/model control itself is absent, report the missing capability and
stop the affected workflow; do not substitute an external CLI or flagship inline
implementation. Roll back any writes belonging to an interrupted installation.

An unknown harness with working ephemeral delegation can execute the portable
workflow without a persistent custom definition. Reuse verified model selection
and compact task packets; do not claim native-template installation in this mode.
