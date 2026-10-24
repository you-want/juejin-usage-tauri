# Juejin Usage — Tauri 社区版桌面端

掘金 AI 用量统计的 Tauri 客户端（本仓库 fork 维护，对齐官方 Electron 版 `apps/desktop` 功能）。与官方版的差别只在壳：渲染层复用同一份 dashboard 构建产物，数据层复用同一套 core local-api 契约。

## 架构一览

```
┌─ Tauri (Rust 壳) ────────────────────────────────┐
│ 主窗: tauri://localhost/dashboard/ (内嵌 dist)    │
│ 托盘 popover / 桌宠: src/renderer (index/pet)     │
│ bridge.rs: 注入 window.tud (Electron preload 同形) │
│                                                  │
│  spawn → node jusage desktop-host (:8462)         │
│           core runtime + local-api + sync         │
└──────────────────────────────────────────────────┘
```

- 主窗口加载 `packages/dashboard` 的 `build:tauri` 产物（`copy-dashboard.mjs` 拷入 `src/renderer/public/dashboard/`），**不占 8452/8462 端口作为页面源**
- 数据请求经注入桥 `tud.api.request` → Rust 代理 → sidecar 的 `127.0.0.1:8462`
- 与 CLI 的 `tud.pid` 互斥、心跳、CLI 自启驱逐都在 Node sidecar（`packages/cli/src/desktop-host.ts`）

## 常用命令（仓库根执行）

| 命令 | 说明 |
|---|---|
| `pnpm dev:desktop:tauri` | 开发运行。**已内置 `tauri dev --no-dev-server`**（原因见下），渲染层改动自动重建+重编译，约 1 分钟一轮，**无 HMR** |
| `pnpm build:desktop:tauri` | 打包（build:cli → stage node-app → tauri build） |
| `pnpm stage:desktop:tauri` | 只准备 node-app staging（node 二进制 + CLI dist + dashboard dist） |

⚠️ **不要给 `tauri.conf.json` 加回 `devUrl`、也不要去掉 `--no-dev-server`**：WKWebView 在部分 macOS 环境下无法加载任何 `http://127.0.0.1` 回环页面（永久 about:blank 白屏），dev 必须与 release 同走 `tauri://localhost` 自定义协议。详见 [docs/troubleshooting.md](docs/troubleshooting.md) 案例 1。

## 为什么安装包 44MB？（体积构成）

解包 `.app` 实测（v0.2.0）：

| 组件 | 体积 | 占比 |
|---|---|---|
| Node.js 运行时二进制（node-app/node） | 110MB | 92% |
| Rust 壳（desktop-tauri） | 10MB | 8% |
| CLI/core dist + node_modules | 6.7MB | ~5% |
| dashboard 前端 dist | 2.6MB | 2% |

「Tauri 应用 <10MB」对纯 Rust 应用成立——本项目的 Rust 壳恰好就是 10MB。大头是**内嵌的 Node 运行时**：这是「Rust 壳 + Node sidecar」架构的代价，换来的是原样复用官方 core 的解析器/同步/上传（以最小开发量对齐 Electron 版全部功能）。dmg 压缩后 127MB→44MB；官方 Electron 版安装包通常 100MB+。

后续可选的瘦身路径（按性价比）：① `bun build --compile` 把 sidecar 编译为独立可执行（预计 dmg ~30MB 级）；② 裁剪版 node 二进制（~35MB，有兼容风险）；③ 数据层 Rust 化（<15MB，等于重写 core，不推荐）。

## 与上游同步（main 只做镜像）

```bash
git remote add upstream https://github.com/juejin-cn/juejin-usage.git   # 首次
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout feat/desktop-tauri-v2 && git merge main && git push        # 开发线跟进上游
```

`main` 不放自己的提交（保持 `--ff-only` 可用）；所有开发都在 `feat/desktop-tauri-v2`（对外默认分支）。

## 发版（维护者）

1. bump 版本：只改 `apps/desktop-tauri/package.json` 的 `version`（`sync-version.mjs` 会同步 tauri.conf.json 与 Cargo.toml）
2. 打标签推送：`git tag v0.x.y && git push origin v0.x.y` → 触发 `.github/workflows/release-tauri.yml`（三平台矩阵构建 + minisign 签名 + latest.json 合并 + Release）
3. 前置：仓库 Secrets 已配置 `TAURI_SIGNING_PRIVATE_KEY`（`~/.tauri/juejin-usage-community.key` 的内容）与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（密钥未设密码，占位即可）
4. 本地完整打包验证：`pnpm build:desktop:tauri`（需要 `TUD_NODE_BIN` 指向目标架构的 node 二进制）

## 文档

- [docs/troubleshooting.md](docs/troubleshooting.md) — 故障排查手册（白屏/注入桥协议等已踩坑案例，遇到问题先查这里）
- [docs/parity-audit.md](docs/parity-audit.md) — 与官方 Electron 版的功能对齐对照清单与实施路线
- [packages/cli/src/desktop-host.ts](../../packages/cli/src/desktop-host.ts) — Node sidecar 的启动/心跳/退出协议（`PORT=`/`SYNCED`/`RUNTIME_NOTICE=` stdout 标记）
