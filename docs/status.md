# 交付状态与验收边界

## Phase 1：完成并验证

独立 TypeScript 工程、精确版本 npm peer/dev 依赖、官方 Cordis/Session 插件加载、Schemastery 配置、默认 Observe、脱敏 JSONL、回放、错误隔离、有界写队列、卸载清理、类型检查/测试/构建。

2026-10-09 已核对本机 Desktop 内置运行时 `0.2.0-rc.2`、Cordis `4.0.4`、Schemastery `3.18.4`。隔离目录安装这组精确 npm 依赖后，类型检查、22 项测试（启用真实 Docker，0 跳过）及构建通过。首次运行有一次 Docker 启动超时，单项复测及完整复测均通过；5 秒容器启动/执行上限在冷启动或宿主繁忙时仍可能触发。peer 兼容声明只增加已验证的 rc.2 版本，不使用版本豁免。隔离测试不等于 Desktop 实际激活。

## Phase 2：主要代码及受控真实 Tool 验收通过，全面验收待补

已实现 Detector、Harness LLM stream Synthesizer、受限 JSON Tool、Schema/TypeScript 检查、Docker 资源限制及超时清理、独立样例、人工审批、官方 Tool/Skill 贡献、重启恢复。集成测试使用官方 registry 和明确可信的测试 fixture。

2026-10-09 新增实测：Docker Desktop Client/Server 29.8.2，已构建 evoforge-sandbox:1，启用 Docker 后 22 项测试全部通过、0 项跳过，覆盖容器执行、独立样例和硬超时终止。日志案例通过 3 个独立 Docker 样例，状态 verified，未人工批准。运行记录在 artifacts/docker-log-verified.json。

真实生成新增实测：通过已安装 Desktop 的官方账号服务和 LLM stream 生成日志 Tool，第二次生成通过 4 组独立 Docker 样例。第一次输出解析失败也计入用量，两次合计实际 3210 Token。显示名 DeepSeek-V41-Flash 的实际模型 ID 已核对为 `deepseek-flash`。用户明确批准后在新 Session 实际调用成功，结果与独立预期一致，registry uses/successes 均为 1，事件耗时 938 ms；详见 [真实生成验收](live-validation.md)。当前 rc.2 和 alpha 两组依赖均通过 23 项测试，包含真实 Docker，0 跳过。

随后另一新 Session 未指定工具名，Agent 自行选择新增日志 Tool 并成功调用，输出与独立预期一致，事件耗时 3386 ms；registry uses/successes 均为 2。这是单个任务的自主选择实测，公开证据在 docs/evidence/live-selection.json。

仍未验证：自动缺口触发的真实生成、自动有限修复及真实 Skill 效果。当前生成是人工指定的受控任务，不能用于声称自动发现通过；两次成功复用不能替代完整 Benchmark。

## Phase 3：主要基础实现并测试

可解释总成本策略、去重、新版本、退役、回滚、决策审计、持久预算与统计、并发写入、篡改检测、故障恢复测试已实现。IMPROVE 为 Tool 生成新候选，重新验证和人工批准；Skill 改进通过人工审阅后的新版本导入完成。

限制：统计阈值与预期收益是启发式，未训练模型；语义近似去重、LLM 分析策略、大文件流式轨迹、PTC 子调用分析没有实现。CLI 所依赖的本地管理目录是可信边界；管理员仍能修改文件，哈希不构成密码学签名。

## Phase 4：Mock 和本地打包，真实研究尚未完成

可执行三组 Mock、客观任务 expected、实际时间和生成/复用统计、JSON/CSV/HTML、双语 README、架构/教程、日志案例、npm tarball 已提供。真实 Agent 三组实验 runner、模型 Token/成本完整汇总、Skill efficacy 与多任务族实验仍待实现。npm 包没有发布；GitHub 仓库与 Actions 入口见 README。

## 安全与可用性约束

- 模型不能通过工具自行批准能力；管理 CLI 必须由可信操作人使用。
- Docker 缺失时拒绝运行生成代码，不能关闭审批，Mock proof 不能批准工具。
- 宿主仅解析 Schema、YAML 和 TypeScript，不执行生成代码。
- Docker 隔离依赖宿主/daemon 和已审查镜像可信；只支持 Linux containers。
- 原始提示、输出和图像默认不存储；开启 payload 后使用启发式脱敏，不保证识别所有业务隐私。
- budget 为累计保守预留，不能冒充真实计费 Token；注册表故障或预算耗尽会阻止演化。
- 2026-10-09 用户确认退出 Desktop 后，通过应用内置 `dsh plugin --profile desktop add` 安装 `dsh-plugin-evoforge@0.1.0`。官方 list 确认依赖，profile 已选择 bundle；使用绝对存储目录、Observe 模式及强制人工审批。初次按显示名填写的模型 ID 随后修正为 `deepseek-account` / `deepseek-flash`。重启后的普通会话及后续工具调用均有真实事件，验收摘要在 artifacts/desktop-install-result.json。
- 后续真实目录统计任务完成：记录 4 次工具调用（pwsh × 3、glob × 1），4 个结果均成功且正确关联，耗时为 593、246、592、569 ms，turn/end 为 completed，无 payload 字段。CLI analyze 成功读取真实轨迹，当前 gaps 和 decisions 均为空；只完成一个工具任务，尚不足重复模式阈值。证据在 artifacts/desktop-tool-observation.json。真实工具观测已通过，生成、审批和新增能力复用仍未验收。
