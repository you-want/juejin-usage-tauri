---
"@juejin-opensource/jusage-core": patch
"@juejin-opensource/jusage": patch
"@juejin-opensource/jusage-desktop": patch
---

降低桌面端后台同步时的主进程卡顿：解析改到独立进程，空轮询不再全量扫描，定价改为启动时拉取一次。
