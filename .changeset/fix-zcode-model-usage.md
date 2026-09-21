---
"@juejin-opensource/jusage-core": patch
"@juejin-opensource/jusage-desktop": patch
---

修复新版 ZCode 不再记录 token 用量的问题：ZCode 新版本把消息里的 `providerID` 字段改名为 `providerId`，导致解析器把所有新消息当作非原生消息跳过；同时新版 ZCode 的 `~/.zcode/cli/db/db.sqlite` 新增了 `model_usage` 用量表，解析器优先读取该表（并修正了缓存 token 双倍计入的问题），旧版本仍回退到 message 表解析。
