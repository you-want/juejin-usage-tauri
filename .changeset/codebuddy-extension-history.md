---
"@juejin-opensource/jusage-core": minor
---

支持读取 CodeBuddy 桌面应用与 VSCode / Cursor 插件的用量数据：此前只解析 CodeBuddy CLI 的 JSONL 记录，用桌面 App 或编辑器插件写代码时用量不会被统计。现在会解析扩展的历史消息（含 Cursor），并把会话归属到实际的项目目录，面板上能按项目看到这些用量。同时补充腾讯 hy4-preview 的定价与 codebuddy「auto」模型的别名解析。CLI 与 Desktop 面板同步生效（同一份 core 解析器）。
