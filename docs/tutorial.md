# 使用教程

## Observe 演示

在项目目录执行 `npm run demo` 或 `dev.cmd demo`。示例通过真实 Cordis 插件生成 Session 事件，并在 `.evoforge/demo/trajectories.jsonl` 保存脱敏轨迹。随后运行：

```sh
node dist/cli.js analyze --storage .evoforge/demo
```

一次 UNKNOWN_TOOL 不足以判定缺口；重复跨任务证据达到阈值才产生候选。真实任务在已装插件的 Harness profile 执行，插件会观察其 Session 事件。`storageDir` 相对 Harness 启动 cwd 解析，CLI 必须指向同一绝对目录，特别是在 Desktop 下。

## 开启生成

参考 `examples/generation.patch.yml`，填入已有 Harness 模型 route 和 model，并启用 `enableGeneration` 和 `autoEvolution`。插件默认不调用模型。预算为累计保守预留，不是实际计费 Token 数。

### 使用 DeepSeek 账号登录

官方账号提供商的 route 为 `deepseek-account`，由 Harness 自己解析登录凭据，EvoForge 无需 API Key。先在 Harness 选择 **DeepSeek Account** 下的模型并发送普通消息，确认账号、额度和模型均可用。

`examples/deepseek-account.patch.yml` 使用实际模型 ID `deepseek-flash`，对应界面的 **DeepSeek-V41-Flash**；当前保持 Observe。不要将显示名写成请求 ID。这是已安装 `evoforge` 条目的配置覆盖，不是插件安装文件；将其字段合并到测试 profile 的配置，并将 `storageDir` 改为确定的绝对目录。准备进行自动生成时，再将 `enableGeneration` 和 `autoEvolution` 改为 `true`；账号调用可能消耗额度。一次受控真实生成的脚本和证据见 [真实生成验收](live-validation.md)。

Desktop 的“插件”页面使用官方插件管理器安装本地包。Desktop profile 受应用管理，命令行修改须使用 Desktop 内置命令并完全退出应用，不能用 npm 安装的 dsh 替代。安装和账号登录须在同一个 profile，不能仅在普通 CLI 测试 Context 中假定已取得 Desktop 的账号服务。

当前 Windows 本地工作区提供 `scripts/install-desktop.ps1`：在 Desktop 完全退出后执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop.ps1`。脚本检查已验证的运行时版本，备份 profile 清单和 patch，通过应用内置命令安装 `artifacts/dsh-plugin-evoforge-0.1.0.tgz`，然后配置账号渠道和 Observe。该脚本使用当前 Windows 用户的默认安装目录和 `.dsh`；自定义 DSH_HOME/安装目录应按实际位置调整。运行后重新打开 Harness，在新对话发送一条消息；`%USERPROFILE%\.dsh\storages\evoforge-desktop\trajectories.jsonl` 应出现 turn 和 usage 记录。安装依赖已选中不等于插件已激活，必须检查真实事件记录。

自动策略从轨迹分析成功流程及缺口，先查插件 registry；待验证候选会去重。现有官方 Registry 同名项禁止覆盖；此版本不支持全面语义匹配已有 Harness 工具，候选仍需人工审查。规则输出 CREATE 时生成 draft；没有人工独立样例就不尝试验证或审批。

可信管理插件可读取 `ctx.evoforge.analyze()`；需声明 `inject = ['evoforge']` 并导入 `dsh-plugin-evoforge` 的 Context 类型扩展。`ctx.evoforge.propose(gap, kind, independentSamples, signal)` 支持带样例生成和最多 `maxRepairs` 次修复，不会人工审批。模型生成的样例被强制归类 generated。

## 日志 Tool 完整管理流程

人工审查 `examples/log-parser.json`，它是人工案例，不冒充真实 LLM 生成结果。准备 Docker Linux containers，构建本地镜像，导入、验证并检查 proof 后批准：

```sh
docker build -t evoforge-sandbox:1 sandbox
node dist/cli.js import examples/log-parser.json --storage /absolute/evoforge-data
node dist/cli.js verify tool:evoforge-log-summary@1 --storage /absolute/evoforge-data
node dist/cli.js show tool:evoforge-log-summary@1 --storage /absolute/evoforge-data
node dist/cli.js approve tool:evoforge-log-summary@1 --reviewer YOUR_NAME --storage /absolute/evoforge-data
```

Docker 缺失时 verify 返回非零退出码，status 保持 draft。2026-10-09 已在本机实际验证 Docker 成功路径：日志 Tool 的 3 个独立样例全部通过，状态 verified，尚未批准。记录在 artifacts/docker-log-verified.json。

同目录的 Harness 插件下一次同步会注册 `evoforge-log-summary`。让 Agent 调用 `{ "text": "2026-10-09T08:00:00Z ERROR timeout" }`，预期输出 `{ "counts": { "INFO": 0, "WARN": 0, "ERROR": 1 }, "malformed": 0 }`。新 Session 和插件重载恢复同一批准版本。

## Skill 管理流程

在 Tool 已批准后，审查和导入 `examples/log-skill.json`：

```sh
node dist/cli.js import examples/log-skill.json --storage /absolute/evoforge-data
node dist/cli.js verify skill:evoforge-log-workflow@1 --storage /absolute/evoforge-data
node dist/cli.js approve skill:evoforge-log-workflow@1 --reviewer YOUR_NAME --storage /absolute/evoforge-data
node dist/cli.js export-skill skill:evoforge-log-workflow@1 --storage /absolute/evoforge-data --output artifacts/skills
```

官方 Skill catalog 负责发现；Agent 调用 `skill({ name: "evoforge-log-workflow" })` 加载。依赖缺失的 Skill 不激活。不要同时将导出的文件放进官方文件发现目录，否则可能与运行时贡献重名；导出主要用于审阅和独立迁移。

## 给自动候选补充样例

人工 JSON 样例数组每项含 `source: "independent"`、`label`、`input`、`expected`：

```sh
node dist/cli.js samples tool:YOUR_NAME@1 --file independent-samples.json
node dist/cli.js verify tool:YOUR_NAME@2
node dist/cli.js approve tool:YOUR_NAME@2 --reviewer YOUR_NAME
```

添加样例创建新版本，旧 proof 不被沿用。修改同名 artifact 也会创建新版本；审批新版本退役旧版，`rollback` 仅允许恢复以前批准过且 proof 匹配的版本。Skill 与 Tool 独立审批。

## Docker 测试与实验

```powershell
$env:EVOFORGE_DOCKER_TESTS = '1'
npm test
```

Docker 三组执行实验使用 Mock 模型返回已审查案例代码，真实执行前必须明确传入审核参数：

```sh
npm run benchmark -- --docker --approve-reviewed-fixture --output artifacts/benchmark-docker
```

这仍不是 LLM 实验；真实模型/Agent 方案见 benchmark 文档。

## 存储和恢复

`registry.json` 保存版本、验证、审批、统计、累计预算和决策。`.registry.lock` 串行化 CLI/插件写入；临时文件、fsync、rename 提交。异常退出可能留下锁；确认所有写进程停止后才人工删除锁。不要重置 registry 来绕过预算。

目录属于可信管理边界：哈希检测意外 code 修改，不是抵御本机管理员篡改审批的签名。Windows 应使用目录 ACL。长期轨迹按文件累积，analyze 完整载入；大型部署须另加轮换/流式查询。
