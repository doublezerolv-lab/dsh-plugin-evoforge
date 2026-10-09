# 真实模型生成验收

2026-10-09，在本机已安装的 Harness Desktop `0.2.0-rc.2` 官方运行时执行。显示名 **DeepSeek-V41-Flash** 的实际模型 ID 为 `deepseek-flash`，账号提供商为 `deepseek-account`。

## 实际结果

脚本通过 Electron Node 模式加载发布包中的 Cordis、LLM、凭据和官方账号适配器。凭据由官方服务内部解析，不输出或复制 token。测试 Context 独立于 Desktop，Desktop 继续保持 Observe。

任务由工程侧人工指定：生成只处理 JSON 输入的日志计数 Tool。这不证明自动缺口检测已经通过。

| 生成尝试 | 实际输入 Token | 实际输出 Token | 实际总 Token | 结果 |
|---|---:|---:|---:|---|
| 第一次 | 713 | 1360 | 2073 | 返回内容未通过 JSON 解析 |
| 第二次 | 737 | 400 | 1137 | 生成成功，4 组独立 Docker 样例通过 |
| 合计 | 1450 | 1760 | 3210 | 1 个 verified 候选 |

两次请求均使用账号渠道，关闭思考，提供方重试次数为 0。两次之间修改了输出格式说明和解析器；这是开发中的两次验收调用，不是自动 repair 功能成功的证据。第一次原始输出没有保留，不对具体格式错误作推断。实际 usage 来自 Harness 流；累计保守预算预留为 8932，不是实际用量。缺少账号账单价格，货币成本未知。

候选为 `tool:evoforge-live-log-summary@1`，fingerprint 为 `030c83b39ffc893369c5bccb0b3800e4fed4ea063d238c233c7d9e988f397b83`。通过官方支持的 Schema 检查、严格 TypeScript 编译、受限源码检查，以及空输入、混合级别/无效行、CRLF/空行、不支持级别/缺少正文四组独立样例。Docker 执行使用 15 秒上限，覆盖容器启动和执行。合同和样例见 `examples/log-generation-contract.md`、`examples/log-generation-samples.json`。

本地完整证据位于 `artifacts/live-generation/`。用户明确批准后，候选在 Desktop registry 中变为 approved，通过插件同步进入官方 Tool Registry。随后在全新 Session 的第 1 个 turn 实际调用成功，输出为 `{"counts":{"INFO":1,"WARN":1,"ERROR":2},"malformed":1}`，与独立预期完全一致。事件耗时 938 ms，registry 使用次数和成功次数均为 1。Desktop 仍保持 Observe，此次调用复用已批准工具，没有重新生成代码。

可公开的汇总为 [生成证据](evidence/live-generation.json)、[新 Session 调用证据](evidence/live-reuse.json)，实际生成代码为 `examples/generated-log-summary.ts`。公开汇总排除本机路径、登录凭据及原始会话。

第二个新 Session 不指定工具名，只要求统计另一组日志。检查持久事件确认任务文本没有工具名，Agent 自行调用 `evoforge-live-log-summary`，输出 `{"counts":{"INFO":2,"WARN":0,"ERROR":1},"malformed":2}`，符合预期，事件耗时 3386 ms。registry 的 uses/successes 都为 2；见 [自主选择证据](evidence/live-selection.json)。这证明该单个任务的自主选择成功，不代表所有任务或模型的通用成功率。

## 复现

在 Windows 默认安装位置、已登录 Harness、已构建沙箱镜像并构建本项目后运行：

```powershell
.\scripts\harness-live.cmd inspect
.\scripts\harness-live.cmd generate artifacts/live-generation
```

`generate` 显式调用真实模型，会使用账号额度。脚本在有候选时拒绝再次生成，持续保留 registry 的预算；不要删除 registry 绕过上限。脚本不会审批候选。自定义安装位置须调整 `.cmd` 的 Electron 路径，并设置 `EVOFORGE_HARNESS_RUNTIME`。生成与验证需要项目依赖及已构建的 `dist`。

## 新对话验收

候选批准后，新建 Harness 对话发送：

```text
请调用 evoforge-live-log-summary 工具，统计下方日志中的 INFO、WARN、ERROR 和无效非空行数量。返回工具的 JSON 结果。
2026-10-09T09:00:00Z INFO started
2026-10-09T09:00:01Z WARN retry
2026-10-09T09:00:02Z ERROR first
2026-10-09T09:00:03Z ERROR second
broken line
```

预期为 `{"counts":{"INFO":1,"WARN":1,"ERROR":2},"malformed":1}`。以实际工具调用、结果及 registry 的 uses/successes 增长确认复用；仅回复正确不能证明工具被调用。

上面的第一次任务明确指定工具名；另一次任务未指定工具名，也已验证调用成功。自动缺口触发生成、自动修复、Skill 效果和完整三组 Agent Benchmark 仍待独立实验。
