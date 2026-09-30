# Code Workers

Code Workers 是一个可移植的 coding skill：主会话负责需求、技术决策、任务拆分和验收，把范围明确的实现工作交给**显式选定模型**的 worker。它提供任务交接规则、七个平台的适配说明，以及离线生成和安装 worker 定义的命令行工具。

支持 Codex、Claude Code、Antigravity、OpenCode、Pi、DeepSeek Harness（DSH）和 ZCode；其他 harness 可生成通用交接提示词。主模型由你选择，skill 不切换主模型、不默认让 worker 继承主模型、不自动升级模型，也不另设 reviewer 模型层。

**要求：**使用脚本需要 Node.js 20+；分发和运行 skill 不需要安装 npm 包，也不依赖 Superpowers。平台必须实际提供委派、模型选择和结果回收能力；安装持久 worker 定义还需要该平台支持对应格式。仅生成模板不能证明模型可用或客户端已加载它。

## 快速开始

1. **放置 skill。**复制整个 [`skills/code-workers`](skills/code-workers) 目录，并保留内部结构。按 [Codex 官方文档](https://learn.chatgpt.com/docs/build-skills)，用户级目录是 `~/.agents/skills/code-workers/`，项目级目录是 `.agents/skills/code-workers/`；其他客户端按其实际支持的导入方式操作。无法确认路径时，可先让主会话读取绝对路径下的 `SKILL.md`。
2. **选择 worker。**调用 `code-workers`，或提出“规划后将实现任务交给低成本 worker”。首次使用时明确选择 worker 模型及兼容的推理强度。主会话先读取当前平台的适配说明，核实调度工具、模型权限、安装位置与已有定义；后续复用已验证的选择。
3. **交付任务。**主会话确定接口、修改范围、验收条件和允许的验证方式后，按[任务包](skills/code-workers/references/task-packet.md)派发。修改范围重叠的任务串行执行；worker 返回 `complete | partial | blocked` 后，主会话检查实际改动和验证证据。若用户要求仅在 CI 中测试，就不运行本地测试，排队中的 CI 也不算通过。

若只想先看生成结果，可在仓库根目录运行一个**离线预览**：

```sh
node skills/code-workers/scripts/worker.mjs render --harness codex --model gpt-6-luna --effort medium
```

此命令将模板打印到标准输出，不修改个人配置，也不会调用模型。示例模型只展示参数格式；使用前仍须确认账户支持。要安装 worker 定义，请继续阅读下文的预检和回滚说明。

示例请求：

> 使用 code-workers。当前会话负责规划和验收，worker 使用我选定的低成本模型。先确认当前平台的原生子 agent 能力与模型路由，再安装或复用模板。不要升级模型。只允许在 CI 中运行测试。

skill 的发现与 worker 定义的安装是两件事：下列脚本只管理 worker 定义，不会自动把 skill 安装到客户端的 skill 目录。

## 平台支持

| Harness | 默认用户级模板位置 | 模型配置 |
|---|---|---|
| [Codex](skills/code-workers/references/codex.md) | `~/.codex/agents/code_worker.toml` | `model`、`model_reasoning_effort`，检查覆盖优先级 |
| [Claude Code](skills/code-workers/references/claude-code.md) | `~/.claude/agents/code-worker.md` | 模型或有效别名、`effort`，检查强制覆盖 |
| [Antigravity](skills/code-workers/references/antigravity.md) | `~/.gemini/config/agents/code-worker.md` | `flash` / `pro` 档位，必须核验工具名 |
| [OpenCode](skills/code-workers/references/opencode.md) | `~/.config/opencode/agents/code-worker.md` | `mode: subagent`、`provider/model`，兼容 provider 的 `reasoningEffort` |
| [Pi](skills/code-workers/references/pi.md) | `~/.pi/agent/agents/code-worker.md` | 官方 subagent 扩展格式，须已安装并启用扩展 |
| [DSH](skills/code-workers/references/dsh.md) | `~/.dsh/profiles/<profile>/cordis.patch.yml` | 现有 profile 中独立入口，固定 provider/model/persona |
| [ZCode](skills/code-workers/references/zcode.md) | `~/.zcode/agents/code-worker.md` | `model`、`thoughtLevel`，仅用户级、新会话生效 |
| [其他](skills/code-workers/references/generic.md) | 仅生成可移植提示词 | 不推测原生路径、调用接口或模型控制能力 |

每次只操作选定平台。路径遵循已支持的环境变量，例如 `CODEX_HOME`、`DSH_HOME`；`--home` 不覆盖这些变量。项目级安装需显式 `--scope project --project-root <路径>`，DSH、ZCode 不支持。Antigravity、Pi 的当前模板没有通用独立 effort 字段，传入 `--effort` 会报错。所有适配说明均记录官方来源、核验日期、调用、回收、继续执行和生效条件；实际版本及工具优先。

## 离线生成

从仓库根目录执行。示例模型、工具名只用于演示格式，不代表账户可用或价格保证：

```sh
node skills/code-workers/scripts/worker.mjs render --harness codex --model gpt-6-luna --effort medium
node skills/code-workers/scripts/worker.mjs render --harness claude-code --model haiku --effort low
node skills/code-workers/scripts/worker.mjs render --harness antigravity --model flash --tools view_file,replace_file_content,run_command
node skills/code-workers/scripts/worker.mjs render --harness opencode --provider openai --model economy --effort low
node skills/code-workers/scripts/worker.mjs render --harness pi --provider vendor --model economy
node skills/code-workers/scripts/worker.mjs render --harness dsh --profile existing-profile --provider vendor --model economy
node skills/code-workers/scripts/worker.mjs render --harness zcode --model economy --effort low
node skills/code-workers/scripts/worker.mjs render --harness another-harness --model economy
```

`render` 向标准输出打印模板，可用 shell 重定向保存。它不安装、不调用模型，也不证明本机能加载模板。所有模板嵌入同一份 [`worker-prompt.md`](skills/code-workers/assets/worker-prompt.md)。原始 [`code-worker-system-prompt.md`](code-worker-system-prompt.md) 保留不变。

## 安装、更新与恢复

主 agent 先完成 [`setup.md`](skills/code-workers/references/setup.md) 的检查，保存与本次目标一致的 `preflight.json`。它是**现场观察记录**，脚本无法代替主 agent 检查当前工具和账户模型权限。不能为了通过检查把未知能力填成 `true`。

记录包含 `schemaVersion: 1`、当前 ISO 时间 `checkedAt`、`harness`、规范化 `model`、`scope`、绝对 `target`、`modelAvailable`、`capabilities` 和具体 `evidence`。传入 provider、effort、profile 时也需逐项记录。记录一小时内有效，配置变化后立即重查；平台附加字段见 setup 文档。

```sh
# 使用已核验的当前平台、模型与实际记录
node skills/code-workers/scripts/worker.mjs install --harness codex --model gpt-6-luna --effort medium --preflight /absolute/path/preflight.json

# 仅明确要求更新已有不同内容时增加 --replace
node skills/code-workers/scripts/worker.mjs install --harness codex --model gpt-6-luna --effort medium --preflight /absolute/path/preflight.json --replace

# 使用安装返回的真实 receipt 路径
node skills/code-workers/scripts/worker.mjs rollback --receipt /absolute/path/receipt.json
```

Windows 将示例路径换成真实绝对路径，有空格时加引号。脚本可从任意目录执行，用实际 skill 位置替换命令中的相对路径。

DSH 只接受已初始化的现有 profile。用 `render --merge-profile` 预览完整候选配置，核验后把其 UTF-8 字节的 SHA-256 写入记录的 `candidateSha256`。不支持的 YAML 结构会报错停止，不重排无关配置。

安装前保存原始字节、文件模式和事务记录。同内容重复安装返回 `unchanged`，不同内容默认冲突。写入或读回检查失败会自动恢复旧文件、撤销新增文件；进程强制退出后可用 receipt 显式回滚。回滚遇到后来修改的内容会停止并保留恢复资料，不覆盖新修改。

事务默认保存在 `~/.code-workers/transactions`，可用 `--state-dir` 指定。记录含原配置，应留在本机，不要提交到仓库。文件检查完成后返回 `installed_pending_reload`，意为“配置已写入，等待新会话验证”。新会话仍需确认发现模板、模型路由正确、最小任务可调用。实际检查失败则回滚并停止；缺少能力或模型时不补装扩展、不转用其他 CLI、不让旗舰自动接手实现。

## 开发与验证

仓库中的 [`SKILL.md`](skills/code-workers/SKILL.md) 是使用入口；[`references`](skills/code-workers/references) 存放平台适配和安装说明；[`worker-prompt.md`](skills/code-workers/assets/worker-prompt.md) 是各模板共用的 worker 指令；[`worker.mjs`](skills/code-workers/scripts/worker.mjs) 实现命令行工具。根目录的 [`code-worker-system-prompt.md`](code-worker-system-prompt.md) 保留原始提示词，验证范围与结果见 [`docs/validation.md`](docs/validation.md)。

```sh
npm ci --ignore-scripts
npm test
```

只有测试需要 YAML/TOML 解析器，分发 skill 无需 `node_modules`。测试覆盖七类格式、完整提示词、中文和路径转义、能力与模型检查、安装冲突、幂等、异常恢复及并发保护。相同场景的无 skill 基线与加载 skill 后结果见 [`docs/validation.md`](docs/validation.md)。

真实调度验证限于当前 Codex 已有 `code_worker` 角色。其他平台通过格式及场景验证，尚未完成各自客户端中的运行验证。生成模板不能视为运行通过，也不构成量化成本节约结论。

## 许可

本仓库采用 [Mozilla Public License 2.0](LICENSE)。
