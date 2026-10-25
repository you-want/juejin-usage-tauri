---
"@juejin-opensource/jusage-core": patch
"@juejin-opensource/jusage": patch
"@juejin-opensource/jusage-desktop": patch
---

修复新版 Cursor 加密登录态后本机订阅额度卡与用量同步读不到的问题：兼容 `cursor-safe-storage` 密文与旧版明文 JWT（macOS 钥匙串 / Windows DPAPI / Linux peanuts·钥匙环），并正确展示 Premium 周额度。
