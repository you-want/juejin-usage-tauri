# @juejin-opensource/jusage-dashboard — React 面板

AI 用量看板前端。构建产物为纯静态 `dist/`，主要随 CLI 一起分发：
`pnpm build:cli` 会把 `dist/**` 复制进 `packages/cli/dist/dashboard/`，
由 `jusage start` 内置 HTTP 服务托管。

## 构建

```bash
pnpm --filter @juejin-opensource/jusage-dashboard build
```

- `build` 默认面向 CLI 托管：根路径 `/`，API 走 `VITE_API_TARGET=cli`（本地 local-api）
- 发 CDN 时可设 `PUBLIC_PATH`（优先于 `VITE_BASE`）覆盖静态资源前缀，见 [.env.production.example](./.env.production.example)
- 本地 UI review 需要假数据时：`VITE_ENABLE_MOCK_DATA=true pnpm --filter @juejin-opensource/jusage-dashboard dev`

## 开发

```bash
# 仓库根一键：API（CLI :8452）+ Vite HMR（:5194）
pnpm dev:cli

# 或单独起面板（dev:cli:ui 等价）
pnpm --filter @juejin-opensource/jusage-dashboard dev

# Web 对照线上：见仓库根 CONTRIBUTING.md
pnpm dev:web
pnpm dev:web:proxy
```
