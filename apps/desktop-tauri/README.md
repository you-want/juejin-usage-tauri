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

## Rust 本地 API（阶段②，实验开关）

设置环境变量 `TUD_API_ENGINE=rust` 启动，Rust(axum) 将接管本地 API 公开端口
（8462）：daily/hourly/breakdown/summary 六条读路由原生实现（数据读
`~/.ai-usage/cache/` 下由 Node 写入的 sealed cache 与 today-live 文件），
未迁移端点透明代理给 Node admin 端口（8463）。默认 `node` 引擎行为与
历史版本完全一致。验证方式与迁移进度见 [docs/roadmap.md](docs/roadmap.md)。

## 为什么安装包 33MB？（体积构成）

解包 `.app` 实测（v0.3.0，经 small-icu node + staging 剥离瘦身，v0.2.x 为 44MB）：

| 组件 | 体积 | 占比 |
|---|---|---|
| Node.js 运行时二进制（node-app/node，small-icu 构建） | 81MB | 82% |
| Rust 壳（desktop-tauri） | 10MB | 10% |
| CLI/core dist + node_modules（已剥离 types/browser/sourcemap） | ~6MB | 6% |
| dashboard 前端 dist | 2.6MB | 3% |

「Tauri 应用 <10MB」对纯 Rust 应用成立——本项目的 Rust 壳恰好就是 10MB。大头仍是**内嵌的 Node 运行时**：这是「Rust 壳 + Node sidecar」架构的代价，换来的是原样复用官方 core 的解析器/同步/上传（以最小开发量对齐 Electron 版全部功能）。官方 Electron 版安装包通常 100MB+。

后续路径见 [docs/roadmap.md](docs/roadmap.md)：阶段② Rust 重写 local-api/store/聚合，阶段③ parsers 渐进迁移，全部完成后安装包预期 ~15MB。

## 与上游同步（main 只做镜像）

```bash
git remote add upstream https://github.com/juejin-cn/juejin-usage.git   # 首次
git remote add juejin-cn https://github.com/juejin-cn/juejin-usage.git   # 首次
git fetch juejin-cn
git checkout upstream && git merge --ff-only juejin-cn/main && git push origin upstream
git checkout main && git merge upstream && git push
```

`upstream` 分支不放自己的提交（保持 `--ff-only` 可用）；所有开发都在 `main`。远端 `upstream` 更名注意：官方上游远端在本仓叫 `juejin-cn`（避免与 `upstream` 分支撞名）。

## 发版（维护者）

1. bump 版本：只改 `apps/desktop-tauri/package.json` 的 `version`（`sync-version.mjs` 会同步 tauri.conf.json 与 Cargo.toml）
2. 打标签推送：`git tag v0.x.y && git push origin v0.x.y` → 触发 `.github/workflows/release-tauri.yml`（三平台矩阵构建 + minisign 签名 + latest.json 合并 + Release）
3. 前置：仓库 Secrets 已配置 `TAURI_SIGNING_PRIVATE_KEY`（`~/.tauri/juejin-usage-community.key` 的内容）与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（密钥未设密码，占位即可）
4. 本地完整打包验证：`pnpm build:desktop:tauri`（需要 `TUD_NODE_BIN` 指向目标架构的 node 二进制）

## 文档

- [docs/troubleshooting.md](docs/troubleshooting.md) — 故障排查手册（白屏/注入桥协议等已踩坑案例，遇到问题先查这里）
- [docs/parity-audit.md](docs/parity-audit.md) — 与官方 Electron 版的功能对齐对照清单与实施路线
- [packages/cli/src/desktop-host.ts](../../packages/cli/src/desktop-host.ts) — Node sidecar 的启动/心跳/退出协议（`PORT=`/`SYNCED`/`RUNTIME_NOTICE=` stdout 标记）
