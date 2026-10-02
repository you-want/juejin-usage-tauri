---
'@juejin-opensource/jusage-desktop': patch
---

Codex 订阅额度读取失败时显示原因和重试入口，临时失败时保留并标记上次额度，暂停自动重试以避免反复触发系统弹窗。未使用 ChatGPT 订阅、未登录或未安装 Codex 时隐藏卡片并清除旧额度。
