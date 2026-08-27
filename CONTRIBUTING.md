# Contributing Guide

源码仓库：[juejin-cn/juejin-usage](https://github.com/juejin-cn/juejin-usage)。

需要 Node.js >= 20。克隆后先在仓库根执行 `pnpm install`。

从 `main` 拉分支，PR 回 `main`。Commit 信息使用英文主语，可加 Emoji 前缀（`✨` / `🐛` / `📝` / `♻️`）。

## 分支规范

`<end>` 只能是 `desktop` | `cli` | `web`。

| 类型 | 格式 | 示例 |
|------|------|------|
| 新功能 | `feat/<end>/<short-desc>` | `feat/cli/service-status` |
| 修 bug | `fix/<end>/<short-desc>` | `fix/web/rank-layout` |
| 文档 / 构建 / 依赖 | `chore/<short-desc>` | `chore/readme-assets` |

跨端改动用影响最大的一端，PR 正文写清范围（例如 `feat/web/share-card`，注明 Desktop renderer 同步改了）。

Fork [juejin-cn/juejin-usage](https://github.com/juejin-cn/juejin-usage) → 按上面开分支 → 提交 Pull Request。

## 按端启动

数据目录：`~/.ai-usage/`。同一时刻不要同时开 Desktop 和 CLI（Desktop 会抢 runtime 并停掉 CLI 服务）。

本地 CLI 用量页（`http://127.0.0.1:8452`）和线上用量页（`https://juejin.cn/aiusage/`）都是同一份 Dashboard（`packages/dashboard`）。

### Desktop

路径：`apps/desktop`

```bash
pnpm install
# 开发热更新：
pnpm dev:desktop
# 构建依赖后启动 Electron
pnpm start:desktop    
```

### CLI

路径：`packages/cli`（面板来自 `packages/dashboard`）

```bash
pnpm install
pnpm start:cli        # 构建后启动，面板 http://127.0.0.1:8452
pnpm dev:cli          # CLI API :8452 + Vite HMR :5194（开发请打开 5194）
```

改 UI 后若用 `start:cli`，需再跑一次 `pnpm build:cli`。

### Web

路径：`packages/dashboard`，本仓库不包含后端。

**方式 A：Whistle**（`https://juejin.cn/aiusage/`）

```bash
pnpm dev:web
```

1. 安装并启动 [Whistle](https://wproxy.org/)（端口 `8899`）或 [whistle 客户端](https://github.com/avwo/whistle-client)（可自动装证书）：

```bash
npm i -g whistle
w2 start
```

浏览器 / 系统代理 `127.0.0.1:8899`。首次 HTTPS 需信任根证书：`http://127.0.0.1:8899` → HTTPS，或 `w2 ca`。

2. Rules：

```text
juejin.cn enable://https
juejin.cn/aiusage/ http://localhost:5194/aiusage/
```

3. 打开 `https://juejin.cn/aiusage/`

**方式 B：Vite proxy**（`http://localhost:5194/aiusage/`）

```bash
pnpm dev:web:proxy
```

1. 登录 `https://juejin.cn`
2. DevTools → Application → Cookies：把 `juejin.cn` 的登录会话拷到 `localhost`（同名同值；含 HttpOnly；不要勾 Secure）
3. 打开用量页并刷新
