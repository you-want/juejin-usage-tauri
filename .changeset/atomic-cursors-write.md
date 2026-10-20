---
"@juejin-opensource/jusage-core": patch
"@juejin-opensource/jusage": patch
"@juejin-opensource/jusage-desktop": patch
---

同步进度文件 cursors.json 改为原子写入，避免进程在写入中途退出后进度丢失、需要重新扫描全部历史记录。
