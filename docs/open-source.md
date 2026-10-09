# 开源交付

项目使用 MIT License。当前适合以早期实验版本开源：两个明确支持的 Harness 版本通过测试，且有真实账号模型生成、Docker 验证、人工批准和新 Session 调用的公开证据。自动缺口发现的真实演化、自动修复、Skill 效果和完整三组 Agent Benchmark 尚未全部验收，发布说明应保持这一边界。

## 准备源码包

```sh
python scripts/prepare-release.py
```

源码 ZIP 采用明确的公开路径列表：源码、测试、双语 README、文档、公开样例、脚本、锁文件和 CI。整个 artifacts、node_modules、dist、.evoforge 和本机 Harness profile 均不进入 ZIP，因此安装备份、原始会话和账号凭据不会被包含。文档中的公开证据仅来自合成日志任务，排除了本机账号信息。

需要 npm Bundle 时，在构建后执行：

```sh
npm pack --pack-destination artifacts/release
```

源码 ZIP 用于创建 GitHub 仓库，tgz 用于 Harness 本地安装。现用 Desktop 安装所引用的旧 tarball 保留原位；新包输出到 release 目录，不覆盖它。

## GitHub 发布说明建议

标题：DSH EvoForge — auditable Tool and Skill evolution for DeepSeek Harness。

描述：独立 Cordis 插件，通过 Session 事件观察 Agent 执行轨迹，结合规则与成本策略生成候选能力，在 Docker 中验证后由人批准，贡献到官方 Tool/Skill Registry 并持久复用。默认 Observe，不修改 Harness 核心。

验收：rc.2 与 alpha 两组明确版本通过 23 项测试。人工指定的日志 Tool 由 DeepSeek-V41-Flash 实际生成，通过 4 组独立 Docker 样例，经用户批准后在两个新 Session 实际调用成功，其中一个任务未指定工具名，由 Agent 自行选择。第一次生成失败也计入用量，两次生成合计 3210 Token。真实三组 Agent 性能与成本比较尚未完成，不宣称性能提升。

GitHub 项目地址为 https://github.com/doublezerolv-lab/dsh-plugin-evoforge ，自动检查结果见仓库 Actions。npm 包尚未发布；源码 ZIP 和本地 tgz 的生成不代表发布到 npm。

发布前使用 `scripts/audit-publication.py` 检查实际 Git 暂存文件或显式公开文件清单。它检查凭据文件路径和常见密钥格式，只报告文件位置，不输出疑似密钥值。GitHub 发布后还应核对远程文件树和归档，确认与审计过的文件集一致。规则扫描不能保证识别所有形式的敏感信息，因此本项目只发布明确选择的公开源码及合成日志任务汇总。
