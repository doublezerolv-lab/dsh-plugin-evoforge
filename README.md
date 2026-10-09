# DSH EvoForge

[![verify](https://github.com/doublezerolv-lab/dsh-plugin-evoforge/actions/workflows/ci.yml/badge.svg)](https://github.com/doublezerolv-lab/dsh-plugin-evoforge/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**让 Agent 的工具与技能随任务积累。**

EvoForge 是面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Tool / Skill 演化插件。它从任务轨迹中识别能力缺口、重复代码和可复用流程，生成工具或技能候选，经验证与人工批准后加入 Harness，供后续会话调用。

[English](README.en.md) · [使用教程](docs/tutorial.md) · [配置示例](examples/generation.patch.yml) · [架构文档](docs/architecture.md)

## 核心功能

- **任务观测**：记录会话事件、工具调用、执行耗时与 Token 用量，支持轨迹持久化和回放。
- **能力发现**：识别缺失工具、重复代码、多步骤流程、慢调用与执行故障，为能力演化提供依据。
- **工具与技能生成**：通过 Harness 已配置的模型生成处理 JSON 输入输出的 TypeScript 工具，以及可复用的 Skill 流程；支持生成预算和有限次数的修复。
- **验证与审批**：使用独立样例验收候选工具，在 Docker 沙箱中执行验证，由用户审阅并批准激活。
- **跨会话复用**：已批准的能力自动接入 Harness Tool / Skill Registry，持久保存，支持新会话调用和重启恢复。
- **版本与成本管理**：支持去重、版本管理、停用、回滚、使用统计，以及创建、复用、改进、退役和延后决策。

默认使用 **Observe 模式**，安装后先观察任务；开启生成后，候选仍需验证和人工批准才能激活。轨迹默认不保存提示词与输出正文，并对敏感字段脱敏。

## 适用场景

- **重复的数据处理**：将反复编写的日志统计、文本解析等代码整理成工具。
- **常用的操作流程**：将多步骤任务整理成 Skill，便于在后续任务中加载。
- **Agent 能力维护**：集中管理候选、审批和版本，查看工具的使用与成功情况。

## 工作流程

观察任务 → 识别可复用能力 → 生成候选 → 样例验证 → 人工批准 → 后续会话复用

工具候选在无网络、非 root、只读根目录的 Docker 沙箱中运行，并设置资源与超时限制。Skill 支持流程契约和工具依赖检查。

## 快速开始

需要 Node.js 22+、npm 和 DeepSeek Harness。工具执行与验证需要 Docker Linux containers。

### 构建与安装

克隆本仓库后，在项目目录执行：

```sh
npm ci --ignore-scripts
npm run build
dsh plugin --profile YOUR_PROFILE add /absolute/path/to/dsh-plugin-evoforge
```

将 `YOUR_PROFILE` 和安装路径替换为自己的配置。Desktop 安装方式见[使用教程](docs/tutorial.md#使用-deepseek-账号登录)。

### 开启生成

插件复用 Harness 已配置的模型渠道，支持 DeepSeek 账号登录。参考[生成配置示例](examples/generation.patch.yml)，设置 `provider`、`model`，并开启：

```yaml
enableGeneration: true
autoEvolution: true
requireApproval: true
```

使用 DeepSeek 账号时，参考[账号配置示例](examples/deepseek-account.patch.yml)，无需为 EvoForge 单独填写 API Key。

### 管理工具

以下示例使用 `.evoforge` 作为存储目录；管理已安装插件时，请指向其配置的 `storageDir`。

```sh
docker build -t evoforge-sandbox:1 sandbox
node dist/cli.js import examples/log-parser.json --storage .evoforge
node dist/cli.js verify tool:evoforge-log-summary@1 --storage .evoforge
node dist/cli.js show tool:evoforge-log-summary@1 --storage .evoforge
node dist/cli.js approve tool:evoforge-log-summary@1 --reviewer YOUR_NAME --storage .evoforge
```

批准后，使用同一存储目录的 Harness 会加载该工具。Agent 可根据任务选择它，例如统计日志中的 INFO、WARN、ERROR 和无效行数量。

CLI 还提供 `analyze`、`list`、`samples`、`retire`、`rollback`、`audit` 和 `export-skill` 等命令。完整操作见[教程](docs/tutorial.md)。

## 兼容版本

| DeepSeek Harness | Cordis |
| --- | --- |
| `0.2.0-rc.2` | `4.0.4` |
| `0.2.1-alpha.1` | `4.0.5-alpha.1` |

同一环境请使用匹配版本的 DSH 依赖包。

## 开发

```sh
npm run check
npm run demo
```

## License

[MIT](LICENSE)
