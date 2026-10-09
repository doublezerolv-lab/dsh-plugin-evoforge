# DSH EvoForge

[![verify](https://github.com/doublezerolv-lab/dsh-plugin-evoforge/actions/workflows/ci.yml/badge.svg)](https://github.com/doublezerolv-lab/dsh-plugin-evoforge/actions/workflows/ci.yml) · MIT · 早期实验版本

基于 DeepSeek Harness 的可审计 Tool / Skill 演化插件。默认 Observe：记录脱敏轨迹、识别缺口；显式开启生成后创建候选，验证并由人批准后才进入官方 Tool / Skill Registry。

已验证的版本组合：DSH `0.2.0-rc.2` / Cordis `4.0.4`，以及 DSH `0.2.1-alpha.1` / Cordis `4.0.5-alpha.1`。已核对本机 Desktop 发布运行时及官方源码 commit `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，未修改 Harness 核心。peer 仅允许这两个明确版本，开发依赖锁定 alpha 组合；不要混用不同 DSH 版本的包。

[English](README.en.md) · [架构](docs/architecture.md) · [教程](docs/tutorial.md) · [实验与限制](docs/benchmark.md) · [交付状态](docs/status.md)

## 已实现

- 官方 Session 事件观测、task/session 关联、call→result 耗时、实际 Token usage、默认不记录提示/输出，JSONL 持久化和回放。
- 可解释规则检测 missing tool、重复代码、成功多步骤流程、慢调用和执行故障；权限/认证/参数失败不会视为缺失能力。
- 调用 `ctx.llm.stream()` 生成受限 JSON→JSON TypeScript 和 Skill；总预算、有限修复、独立验收样例、Docker 验证。
- CREATE / REUSE / IMPROVE / RETIRE / DEFER 成本策略，带理由、指标和结果的决策日志。
- 原子本地 registry、版本、去重、验证与人工审批、停用、回滚、跨 Session 恢复和 Tool / Skill 使用统计。
- 官方 Tool / Skill Registry 动态贡献、定时同步审批变更、卸载清理；管理 CLI、双语文档、日志案例、Mock 三组实验及 npm bundle。

## 本地运行

需要 Node.js 22+ 和 npm。无需模型 Key 即可检查和演示：

```sh
npm ci --ignore-scripts
npm run check
npm run demo
npm run benchmark
```

当前 Windows 工作区已准备便携式 Node.js；也可以在项目目录执行：

```powershell
.\dev.cmd check
.\dev.cmd demo
.\dev.cmd benchmark
```

`demo` 使用真实 Cordis/Session 服务生成观测记录，但其任务和结果是明确的演示事件。`benchmark` 实际执行 12 个共享日志任务 × 3 组，使用 Mock 模型和人工编写的可信执行器；不在宿主执行生成代码。JSON、CSV 和 HTML 图表输出到 `artifacts/benchmark-mock/`。Token 和货币成本没有真实测量时保留 `null`。Mock 不用于声称 LLM 成功率或性能提升。

## 安装到 Harness

先构建，然后在单独测试 profile 安装本地包：

```sh
npm run build
dsh plugin --profile evoforge-demo add /absolute/path/to/dsh-plugin-evoforge
dsh --profile evoforge-demo --dump-config
```

profile 的应用界面由其已有 bundle 决定；在现有测试 Web/SDK profile 安装插件即可保留该界面。`cordis.patch.yml` 默认仅添加 EvoForge，不替换模型、工具或 Agent Loop。不要将路径直接照抄成你的安装路径。

也可安装打包产物：

```sh
npm pack --pack-destination artifacts
dsh plugin --profile YOUR_TEST_PROFILE add ./artifacts/dsh-plugin-evoforge-0.1.0.tgz
```

## 管理能力

```sh
node dist/cli.js analyze --storage .evoforge
node dist/cli.js list --storage .evoforge
node dist/cli.js import examples/log-parser.json --storage .evoforge
node dist/cli.js verify tool:evoforge-log-summary@1 --storage .evoforge
node dist/cli.js approve tool:evoforge-log-summary@1 --reviewer YOUR_NAME --storage .evoforge
node dist/cli.js retire tool:evoforge-log-summary@1 --storage .evoforge
node dist/cli.js audit --storage .evoforge
```

工具验证需要 Docker 本地镜像：

```sh
docker build -t evoforge-sandbox:1 sandbox
node dist/cli.js sandbox-check
```

Docker 缺失会验证失败，审批无法通过；不会退回宿主执行。运行时使用无网络、只读根目录、非 root、移除 capabilities、CPU/内存/PID/超时限制，仅挂载本次代码的临时目录；无宿主环境变量或工作区挂载。v0.1 只支持 Linux Docker containers。

人工批准始终强制开启，`requireApproval: false` 被拒绝。审批 CLI 是可信管理入口，不作为模型工具提供。自动生成缺少独立验收样例时保留 draft；用 `samples` 导入人工样例会创建新版本，重新验证后审批。

## 验证边界

Phase 1 的真实插件加载、观测和卸载已验证。Tool/Skill Registry 接入、重启恢复和版本流程已有集成测试；工具执行测试使用明确的可信 fixture，不等于 Docker 实验。

2026-10-09 已在本机安装 Docker、构建沙箱镜像；当前两个支持版本均通过 23 项测试，0 项跳过，包括实际容器执行与超时终止。Docker 测试默认仍为 opt-in，启用方式见教程。Skill 验证仅检查独立流程契约，尚不能证明模型会遵循步骤。重复代码检测基于精确的脱敏参数指纹；PTC 子调用分析、语义去重、长轨迹流式分析、自动缺口触发的真实生成和完整真实 Agent 三组实验留待后续。

真实账号模型验收通过：人工指定的日志 Tool 由 DeepSeek-V41-Flash 生成，通过 4 组独立 Docker 样例，经用户批准后在两个新 Session 实际调用成功。第一次明确指定工具名，第二次由 Agent 自行选择；输出均符合独立预期，uses/successes 均为 2，事件耗时分别为 938、3386 ms。两次生成合计实际 3210 Token。这是单一日志任务族的验收，尚不代表通用成功率或性能提升。[代码、公开证据与验收边界](docs/live-validation.md)。

MIT License。npm 包尚未发布，可按教程构建并本地安装；账号调用可能消耗额度，货币成本尚未取得。
