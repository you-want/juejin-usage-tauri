---
"@juejin-opensource/jusage-core": patch
"@juejin-opensource/jusage": patch
"@juejin-opensource/jusage-desktop": patch
---

修复把面板时间范围从 7 天扩大到 30 / 90 天后 Token、费用和会话数被重复计算的问题：扩大范围触发的历史重扫改为用重扫结果覆盖已有数据，不再和旧数据相加；Desktop 的同步进程也会在主进程清空 cursor 后丢弃自己的缓存，保证补扫真的执行。
