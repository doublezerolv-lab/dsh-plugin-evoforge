# Benchmark 方法与实际结果

## 当前可运行实验

`npm run benchmark` 使用同一份 `benchmark/tasks.json` 的 12 项日志任务，输出客观计数和 malformed 数量，逐项与独立人工 expected 比较。运行结果包括时间戳、任务集 SHA256、逐任务成功/耗时/生成次数/复用、生成与验证耗时、首次任务与后续平均耗时，另有 JSON、CSV、HTML 图表。

| 分组 | 行为 |
|---|---|
| Baseline | 可信固定解析器处理每项任务，无生成 |
| CodeGen | 每项调用 Mock Harness stream，得到案例代码，静态编译并验证，任务后丢弃 |
| EvoForge | 首项相同生成和验证，将 artifact/verification 写入实际本地 registry，后续从磁盘读取复用，中途重建 registry 对象模拟恢复 |

Mock 模式的执行器是另行人工编写的固定解析器，不评估生成的 JS；proof 标记 `mock`，registry 禁止将它批准成可执行 Tool。复用统计说明 Mock driver 是否读取缓存 artifact，不代表真实 Agent 自主检索能力。Baseline 是强固定工具，不能故意削弱其成功率。

配置有效 Docker 后，`--docker --approve-reviewed-fixture` 会改用真实 Docker 执行案例代码、完成独立样例验证和显式审查固定案例的审批。模型仍是 Mock。Docker 开销也计入结果。

没有真实模型时 `averageTokens` 和 `moneyCost` 始终 `null`。`generationPromptBytes` 是实际传给 Mock stream 的 UTF-8 字节数，不是 Token 估算。generationSuccessRate 是候选通过验收的比例。Skill efficacy/reuse 当前没有实验，保留 `null`。

所有耗时使用真实 `performance.now()`，包含 registry、编译和验证成本。三组顺序固定且单次执行，时延会受 JIT、缓存和 OS 噪声影响；结果用于实现行为分析，不是显著性结论。需要重复、多种顺序和置信区间才能进行严谨性能对比。静态编译使用与运行时注册相同的检查；EvoForge 每个已加载版本编译一次，中途恢复再编译。

本次实际结果见工作区 `artifacts/benchmark-mock/results.json` 和 `report.html`；不将数字手工填入源代码。已执行运行中各组 12 项结果均正确，CodeGen 生成 12 次，EvoForge 生成 1 次、复用 11 次。固定解析器速度领先，这也显示能力演化并不总能优于足够好的已有工具。

有 matplotlib 时运行 `python benchmark/plot.py artifacts/benchmark-mock` 导出 PNG/SVG 图。耗时图采用明确标注的对数坐标，保留 Baseline 优势；绘图直接读取 JSON 实测数据。

## 真实 Agent 实验方案（尚未自动化或执行）

使用匹配 Harness 的三个独立测试 profile、相同模型 route/model、温度、最大 output tokens 和任务顺序。先录制固定任务集与独立 expected；禁止把测试输出告知待测模型。Baseline 不装 EvoForge；CodeGen 使用 Harness 已有临时代码工具且无插件持久能力；EvoForge 显式启用生成，第一阶段由人审查样例和能力，然后在第二阶段的新 Session 复用。

记录所有模型调用 usage，包括能力生成/修复和失败重试；记录 Docker/验证成本和人审查成本。没有 usage 的调用保持 unknown，不能算成零。模型价格来自实际提供方账单配置，不能将策略中的 `savedTokensPerUse` 当测量值。总成本公式为任务模型成本 + 生成/修复成本 + 验证成本；复用收益以全任务累计成本比较。

至少加入日志、格式转换、信息提取等多个独立任务族，并保留负收益场景。执行插件关闭、恢复、旧版本回滚和不同 Session 的复用实验。要声称 Skill 有效，需另外比较有/无 Skill 的真实任务结果与遵循率。

2026-10-09 已通过官方账号渠道执行受控生成验收：两次真实调用合计 3210 Token，首次输出解析失败，第二次生成通过 4 组独立 Docker 样例；详见 [真实生成验收](live-validation.md)。账号货币成本未知，不能称为免费。尚未提供完整三组真实 Agent 自动化 runner，本交付没有真实 LLM 的性能提升结论。
