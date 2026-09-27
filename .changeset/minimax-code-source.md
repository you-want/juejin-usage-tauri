---
"@juejin-opensource/jusage-core": minor
"@juejin-opensource/jusage": minor
"@juejin-opensource/jusage-dashboard": minor
"@juejin-opensource/jusage-desktop": minor
---

新增 MiniMax Code 用量数据源：CLI 与桌面端共用同一份 SQLite 投影（`~/.minimax/v2/sqlite/runtime-state.sqlite`），增量游标按 `local_runtime_token_usage.id` 与本地会话工程目录联表聚合。

同步方式：`jusage sync --source=minimax-code`（别名 `mcode` / `minimax`，环境变量 `MINIMAX_CODE_HOME` / `MINIMAX_DATA_DIR` / `MAVIS_DATA_DIR` 可覆盖数据目录）。面板与桌面 About / Provider 图标一并露出 MiniMax Code 条目。
