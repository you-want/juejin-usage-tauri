---
'@juejin-opensource/jusage-desktop': patch
---

修复静默启动后再次打开应用不显示窗口、初始化期间丢失窗口打开请求的问题。恢复原生 SIGTRAP 的退出行为，避免原生故障被退出清理依赖转为持续占用 CPU、无法重新打开的卡死进程。
