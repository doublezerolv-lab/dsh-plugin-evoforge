# DSH EvoForge 开发计划

参考源码：deepseek-ai/deepseek-harness @ 5badb15009ae1756c3afe0ae0cef1faafc290ccc，包版本 0.2.1-alpha.1；Cordis 4.0.5-alpha.1。

1. Phase 1：独立 npm bundle、Schemastery 配置、session/event 观测、脱敏 JSONL 持久化与回放；使用真实 Cordis 和 Session 测试加载、隔离错误、卸载。
2. Phase 2：可解释缺口检测、受限 JSON→JSON TypeScript 生成、独立测试样例、Docker fail-closed 验证、人工审批、Tool/Skill 动态注册和重启恢复。
3. Phase 3：总成本驱动策略、去重、版本管理、回滚和退役、运行统计及决策审计。
4. Phase 4：相同任务集的三组实验、实际执行结果与图表、双语文档、演示和 npm pack 验证。

每阶段运行类型检查、测试、构建。初始机器没有 Docker；2026-10-09 用户安装后已构建镜像并完成真实容器验证。不得在宿主执行不可信代码。付费模型实验仅在依赖可用时运行，未执行的验收项必须明确保留。

## 当前进度

- [x] Phase 1 实现与真实 Cordis/Session 验证。
- [x] Phase 2 核心模块、CLI 和真实 Tool/Skill Registry 集成测试。
- [x] Phase 2 Docker 执行、独立样例、超时测试和日志案例验证（当前两个支持版本均 23 项测试通过，无跳过）。
- [x] 真实账号模型生成日志 Tool，4 个独立样例验证，用户批准。
- [x] 新 Session 中真实 Agent 调用已批准的模型生成 Tool，实际结果符合独立预期。
- [x] 一个未指定工具名的新任务中，Agent 自行选择新增 Tool，实际结果符合预期。
- [ ] Phase 2 自动发现/修复和真实 Skill 效果验收。
- [x] Phase 3 版本、策略、预算、回滚、审计及边界测试。
- [x] Phase 4 Mock 三组、执行产物、双语文档、本地 npm bundle。
- [ ] Phase 4 真实 Agent 对照实验、完整 Token/成本核算和 Skill efficacy。

详细交付边界见 `docs/status.md`，运行证据见 artifacts 与测试；没有未执行实验的性能数据。
