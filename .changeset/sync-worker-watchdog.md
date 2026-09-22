---
"@juejin-opensource/jusage-desktop": patch
---

同步 worker 内置硬看门狗：事件循环意外卡死超过 5 分钟时自动结束进程并走宿主既有崩溃重启流程，任何原生层故障都不再表现为持续 100% CPU 的僵尸进程（见 #187）。
