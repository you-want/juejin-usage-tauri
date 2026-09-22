---
"@juejin-opensource/jusage-core": patch
"@juejin-opensource/jusage-desktop": patch
---

修复新版 Cline 用量无法采集的问题：新增读取 `~/.cline/data/sessions` 中的 SDK 会话 token 指标，同时保留旧版 VS Code globalStorage 采集逻辑。
