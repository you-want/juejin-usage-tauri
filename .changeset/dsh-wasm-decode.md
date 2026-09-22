---
"@juejin-opensource/jusage-core": patch
---

修复 Desktop 端同步 DSH 数据源时 `tud-sync-worker` 100% CPU 永久卡死：多帧 zstd 会话文件改用纯 JS 解码器一次解出，不再触发 Electron 内置 Node 的原生崩溃（见 #187）。首次同步大体积 DSH 会话的耗时会有所增加（约十秒级），日常增量同步不受影响。
