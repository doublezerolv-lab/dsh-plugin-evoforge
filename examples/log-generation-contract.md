# 真实模型生成验收合同

目标：通过 Harness 已登录的 `deepseek-account` / `deepseek-flash`（显示名 DeepSeek-V41-Flash）生成一个新的纯 JSON 日志统计 Tool，然后在 Docker 中验证，人工审查批准，再在新 Session 中调用。

这是人工指定任务的生成链路验收；不作为自动缺口检测成功的证据。现有 `examples/log-parser.json` 是人工代码，不可替代真实模型生成结果。

输入为 `{ "text": string }`。忽略空行；有效行严格使用 `YYYY-MM-DDTHH:mm:ssZ LEVEL message` 格式，其中 LEVEL 仅为 INFO、WARN、ERROR，message 至少一个字符。时间部分检查字符串格式，不检查真实日历日期。输出严格为 `{ "counts": { "INFO": integer, "WARN": integer, "ERROR": integer }, "malformed": integer }`，不添加其他字段。

生成代码只能执行纯 JSON 转换，无文件系统、网络、宿主进程访问和外部依赖。验收样例在 `log-generation-samples.json`，由工程侧预先编写，不能被生成模型修改或重标来源。

第一次只允许一次生成尝试，关闭自动演化和自动修复。真实调用消耗账号额度；12000 Token 是插件的保守预留上限，不是账单或人民币额度。先完成可信管理入口与模型调用接入，再启用这次验收；当前 Desktop 仍保持 Observe。

批准前必须给用户呈现：实际生成代码、输入/输出 Schema、独立样例验证结果，以及运行时权限。只有用户明确批准该具体候选后才激活。最后在新 Session 输入另一组日志，核对新增 Tool 的实际调用记录和统计结果。
